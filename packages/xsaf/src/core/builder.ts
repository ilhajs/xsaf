import type { StandardSchemaV1, XsafToolSchema } from "../standard-schema";
import { EventBus } from "../events/event-bus";
import { parseCron } from "../scheduler/cron";
import type {
  AgentConfig,
  DelegateOptions,
  EventHandler,
  EventType,
  HumanApprovalHandler,
  InvokeResult,
  ScheduleConfig,
  ServeConfig,
  ToolConfig,
  XsafChannelDriver,
  XsafMcpDriver,
  XsafMemoryDriver,
  XsafSandboxDriver,
} from "../types";
import { XsafAgent, type AgentDefinition, type ResourceDefinition } from "./agent";

const TOOL_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

function required(name: string, value: string): void {
  if (!value.trim()) throw new TypeError(`Agent ${name} is required`);
}

function validateConfig(config: AgentConfig): void {
  required("model", config.model);
  required("baseURL", config.baseURL);
  required("apiKey", config.apiKey);
  required("persona", config.persona);
  if (
    config.maxSteps !== undefined &&
    (!Number.isInteger(config.maxSteps) || config.maxSteps < 1)
  ) {
    throw new TypeError("Agent maxSteps must be a positive integer");
  }
}

function validateTool(config: ToolConfig): void {
  if (!TOOL_NAME.test(config.name))
    throw new TypeError(`Invalid snake_case tool name: ${config.name}`);
  required("tool description", config.description);
  if (config.retries !== undefined && (!Number.isInteger(config.retries) || config.retries < 0)) {
    throw new TypeError("Tool retries must be a non-negative integer");
  }
  if (config.timeout !== undefined && (!Number.isFinite(config.timeout) || config.timeout <= 0)) {
    throw new TypeError("Tool timeout must be greater than zero");
  }
  if (!config.input?.["~standard"]?.validate)
    throw new TypeError("Tool input must implement Standard Schema V1");
  if (!config.input["~standard"].jsonSchema?.input)
    throw new TypeError("Tool input must implement Standard JSON Schema V1");
  try {
    config.input["~standard"].jsonSchema.input({ target: "draft-07" });
  } catch (error) {
    throw new TypeError("Tool input JSON Schema conversion failed", {
      cause: error,
    });
  }
}

export class XsafBuilder {
  readonly #config: AgentConfig;
  readonly #events = new EventBus();
  readonly #tools: ToolConfig[] = [];
  readonly #resources: ResourceDefinition[] = [];
  readonly #names = new Set<string>();
  #runtime: XsafAgent | undefined;
  #sealed = false;

  constructor(config: AgentConfig) {
    validateConfig(config);
    this.#config = { ...config };
  }

  tool<Schema extends XsafToolSchema>(config: ToolConfig<Schema>): this {
    this.#assertConfigurable();
    validateTool(config);
    this.#reserveName("tool", config.name);
    this.#tools.push(config as unknown as ToolConfig);
    return this;
  }

  delegate(agent: XsafAgent, options: DelegateOptions = {}): this {
    this.#assertConfigurable();
    if (!agent.name) throw new TypeError("Delegated agents must be sealed with asAgent(name)");
    this.#reserveName("delegate", agent.name);
    this.#resources.push({ type: "delegate", value: { agent, options } });
    return this;
  }

  sandbox(driver: XsafSandboxDriver): this {
    this.#assertConfigurable();
    this.#reserveName("sandbox", driver.name);
    this.#resources.push({ type: "sandbox", value: driver });
    return this;
  }

  memory(driver: XsafMemoryDriver): this {
    this.#assertConfigurable();
    if (this.#resources.some((resource) => resource.type === "memory")) {
      throw new Error("Only one memory driver may be configured");
    }
    this.#resources.push({ type: "memory", value: driver });
    return this;
  }

  channel(driver: XsafChannelDriver): this {
    this.#assertConfigurable();
    this.#reserveName("channel", driver.name);
    this.#resources.push({ type: "channel", value: driver });
    return this;
  }

  mcp(driver: XsafMcpDriver): this {
    this.#assertConfigurable();
    this.#reserveName("mcp", driver.name);
    this.#resources.push({ type: "mcp", value: driver });
    return this;
  }

  serve(config: ServeConfig): this {
    this.#assertConfigurable();
    this.#resources.push({ type: "serve", value: config });
    return this;
  }

  schedule(config: ScheduleConfig): this {
    this.#assertConfigurable();
    parseCron(config.cron);
    new Intl.DateTimeFormat("en-US", {
      timeZone: config.timezone ?? "UTC",
    }).format(new Date());
    this.#resources.push({ type: "schedule", value: config });
    return this;
  }

  on<Type extends EventType>(type: Type, handler: EventHandler<Type>): this {
    this.#events.on(type, handler);
    return this;
  }

  /** Registers a privileged handler that may inspect validated tool arguments. */
  approve(handler: HumanApprovalHandler): this {
    this.#events.approve(handler);
    return this;
  }

  asAgent(name: string, description?: string): XsafAgent {
    this.#assertConfigurable();
    this.#assertExecutionSandbox();
    if (!TOOL_NAME.test(name)) throw new TypeError(`Invalid snake_case agent name: ${name}`);
    this.#sealed = true;
    return new XsafAgent(this.#definition(name, description));
  }

  async start(): Promise<XsafAgent> {
    if (this.#runtime) return this.#runtime.start();
    this.#assertExecutionSandbox();
    this.#sealed = true;
    const runtime = new XsafAgent(this.#definition());
    this.#runtime = runtime;
    try {
      await runtime.start();
      return runtime;
    } catch (error) {
      this.#runtime = undefined;
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.#runtime?.stop();
    this.#runtime = undefined;
  }

  async invoke(prompt: string, sessionId?: string): Promise<InvokeResult> {
    if (!this.#runtime) throw new Error("Agent must be started before invocation");
    return this.#runtime.invoke(prompt, sessionId);
  }

  run(prompt: string, sessionId?: string): Promise<InvokeResult> {
    return this.invoke(prompt, sessionId);
  }

  ask<Output>(
    prompt: string,
    schema: StandardSchemaV1<unknown, Output>,
    sessionId?: string,
  ): Promise<Output> {
    if (!this.#runtime) throw new Error("Agent must be started before invocation");
    return this.#runtime.ask(prompt, schema, sessionId);
  }

  get app(): XsafAgent["app"] {
    if (!this.#runtime) throw new Error("Agent must be started before accessing the Hono app");
    return this.#runtime.app;
  }

  fetch(request: Request): Promise<Response> {
    if (!this.#runtime) throw new Error("Agent must be started before handling requests");
    return this.#runtime.fetch(request);
  }

  get channels(): ReadonlyMap<string, XsafChannelDriver> {
    return (
      this.#runtime?.channels ??
      new Map(
        this.#resources.flatMap((resource) =>
          resource.type === "channel" ? [[resource.value.name, resource.value] as const] : [],
        ),
      )
    );
  }

  #definition(name?: string, description?: string): AgentDefinition {
    return {
      config: this.#config,
      events: this.#events,
      tools: [...this.#tools],
      resources: [...this.#resources],
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
    };
  }

  #assertExecutionSandbox(): void {
    const hasDefault = this.#resources.some((resource) => resource.type === "sandbox");
    const hasUnisolatedTool = this.#tools.some((tool) => !tool.sandbox);
    const hasUnisolatedDelegate = this.#resources.some(
      (resource) => resource.type === "delegate" && !resource.value.options.sandbox,
    );
    const hasMcp = this.#resources.some((resource) => resource.type === "mcp");
    if (!hasDefault && (hasUnisolatedTool || hasUnisolatedDelegate || hasMcp)) {
      throw new Error(
        "Executable tools require an explicit sandbox. Configure AgentOS or opt into unsafe local execution with .sandbox(local()).",
      );
    }
  }

  #reserveName(kind: string, name: string): void {
    required(`${kind} name`, name);
    const key = kind === "tool" || kind === "delegate" ? `model:${name}` : `${kind}:${name}`;
    if (this.#names.has(key)) throw new Error(`Duplicate ${kind} name: ${name}`);
    this.#names.add(key);
  }

  #assertConfigurable(): void {
    if (this.#sealed) throw new Error("Builder is sealed and cannot be changed");
  }
}

export const xsaf = {
  agent(config: AgentConfig): XsafBuilder {
    return new XsafBuilder(config);
  },
};
