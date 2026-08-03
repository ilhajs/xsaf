import type { StandardSchemaV1, XsafToolSchema } from "../standard-schema";
import { HonoBackbone } from "../backbone/hono";
import type { EventBus } from "../events/event-bus";
import { InMemoryMemory } from "../memory/in-memory";
import { XsaiModelAdapter } from "../model/xsai-adapter";
import { CronScheduler } from "../scheduler/cron";
import type {
  AgentConfig,
  AgentResult,
  AgentStreamResult,
  DelegateOptions,
  InvokeResult,
  McpConnection,
  McpToolDefinition,
  Message,
  ModelRequest,
  ModelStreamResponse,
  ScheduleConfig,
  ServeConfig,
  ToolConfig,
  XsafChannelDriver,
  XsafMcpDriver,
  XsafMemoryDriver,
  XsafSandboxDriver,
} from "../types";
import { toModelTool } from "./tool-executor";

export type ResourceDefinition =
  | { readonly type: "sandbox"; readonly value: XsafSandboxDriver }
  | { readonly type: "memory"; readonly value: XsafMemoryDriver }
  | { readonly type: "channel"; readonly value: XsafChannelDriver }
  | { readonly type: "mcp"; readonly value: XsafMcpDriver }
  | { readonly type: "delegate"; readonly value: DelegateRegistration }
  | { readonly type: "serve"; readonly value: ServeConfig }
  | { readonly type: "schedule"; readonly value: ScheduleConfig };

export interface DelegateRegistration {
  readonly agent: XsafAgent;
  readonly options: DelegateOptions;
}

export interface AgentDefinition {
  readonly config: AgentConfig;
  readonly tools: readonly ToolConfig[];
  readonly resources: readonly ResourceDefinition[];
  readonly events: EventBus;
  readonly name?: string;
  readonly description?: string;
}

function isStream(result: InvokeResult): result is AgentStreamResult {
  return "textStream" in result;
}

async function collect(result: InvokeResult): Promise<AgentResult> {
  if (!isStream(result)) return result;
  for await (const _chunk of result.textStream) {
    // Consuming the stream drives the provider and the completion promise.
  }
  return result.completed;
}

function delegateSchema(): XsafToolSchema<unknown, { readonly prompt: string }> {
  return {
    "~standard": {
      version: 1,
      vendor: "xsaf",
      jsonSchema: {
        input: () => ({
          type: "object",
          properties: { prompt: { type: "string" } },
          required: ["prompt"],
          additionalProperties: false,
        }),
        output: () => ({ type: "object" }),
      },
      validate(value) {
        if (
          typeof value === "object" &&
          value !== null &&
          "prompt" in value &&
          typeof value.prompt === "string"
        ) {
          return { value: { prompt: value.prompt } };
        }
        return {
          issues: [{ message: "Expected an object with a string prompt" }],
        };
      },
    },
  };
}

export class XsafAgent {
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly channels: ReadonlyMap<string, XsafChannelDriver>;
  readonly backbone: HonoBackbone;
  readonly #definition: AgentDefinition;
  readonly #channelMap = new Map<string, XsafChannelDriver>();
  readonly #delegates = new Map<string, DelegateRegistration>();
  readonly #startedResources: Array<() => Promise<void>> = [];
  readonly #mcpTools: ToolConfig[] = [];
  readonly #mcpConnections: McpConnection[] = [];
  readonly #modelToolNames = new Set<string>();
  readonly #sessionTails = new Map<string, Promise<void>>();
  #memory: XsafMemoryDriver = new InMemoryMemory();
  #sandbox?: XsafSandboxDriver;
  #state: "idle" | "starting" | "started" | "stopping" = "idle";
  #startPromise: Promise<this> | undefined;
  #stopPromise: Promise<void> | undefined;

  constructor(definition: AgentDefinition) {
    this.#definition = definition;
    this.name = definition.name;
    this.description = definition.description;
    this.channels = this.#channelMap;
    this.backbone = new HonoBackbone({
      name: definition.name ?? "xsaf",
      invoke: async (prompt, sessionId) => collect(await this.invoke(prompt, sessionId)),
    });
    for (const tool of definition.tools) this.#modelToolNames.add(tool.name);
    for (const resource of definition.resources) {
      if (resource.type === "channel") this.#channelMap.set(resource.value.name, resource.value);
      if (resource.type === "delegate" && resource.value.agent.name) {
        this.#delegates.set(resource.value.agent.name, resource.value);
        this.#modelToolNames.add(resource.value.agent.name);
      }
    }
  }

  get started(): boolean {
    return this.#state === "started";
  }

  get app(): HonoBackbone["app"] {
    return this.backbone.app;
  }

  fetch(request: Request): Promise<Response> {
    return this.backbone.fetch(request);
  }

  start(): Promise<this> {
    if (this.#state === "started") return Promise.resolve(this);
    if (this.#startPromise) return this.#startPromise;
    if (this.#stopPromise) return this.#stopPromise.then(() => this.start());
    this.#state = "starting";
    const start = (async () => {
      try {
        for (const resource of this.#definition.resources) await this.#startResource(resource);
        this.#state = "started";
        return this;
      } catch (error) {
        try {
          await this.#closeStarted();
        } finally {
          this.#state = "idle";
        }
        throw error;
      } finally {
        this.#startPromise = undefined;
      }
    })();
    this.#startPromise = start;
    return start;
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    if (this.#state === "idle") return Promise.resolve();
    const stop = (async () => {
      try {
        if (this.#startPromise) {
          try {
            await this.#startPromise;
          } catch {
            return;
          }
        }
        this.#state = "stopping";
        await this.#closeStarted();
      } finally {
        this.#state = "idle";
        this.#stopPromise = undefined;
      }
    })();
    this.#stopPromise = stop;
    return stop;
  }

  async invoke(prompt: string, sessionId = "default"): Promise<InvokeResult> {
    this.#assertStarted();
    return this.#executePrompt(prompt, sessionId);
  }

  async ask<Output>(
    prompt: string,
    schema: StandardSchemaV1<unknown, Output>,
    sessionId = "default",
  ): Promise<Output> {
    this.#assertStarted();
    return this.#withSessionLock(sessionId, async () => {
      const adapter = this.#definition.config.modelAdapter ?? new XsaiModelAdapter();
      if (!adapter.ask)
        throw new Error("The configured model adapter does not support structured output");
      await this.#memory.append(sessionId, { role: "user", content: prompt });
      const messages = await this.#memory.get(sessionId);
      const value = await adapter.ask(this.#request(messages, sessionId), schema);
      await this.#memory.append(sessionId, {
        role: "assistant",
        content: JSON.stringify(value),
      });
      return value;
    });
  }

  async prompt(name: string, args?: Readonly<Record<string, unknown>>): Promise<string> {
    this.#assertStarted();
    for (const connection of this.#mcpConnections) {
      if (connection.prompts) return connection.prompts.get(name, args);
    }
    throw new Error(`MCP prompt not found: ${name}`);
  }

  async #withSessionLock<Result>(
    sessionId: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const previous = this.#sessionTails.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.#sessionTails.set(sessionId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      void tail.finally(() => {
        if (this.#sessionTails.get(sessionId) === tail) this.#sessionTails.delete(sessionId);
      });
    }
  }

  async #executePrompt(
    prompt: string,
    sessionId: string,
    inherited: readonly Message[] = [],
  ): Promise<InvokeResult> {
    const previous = this.#sessionTails.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.#sessionTails.set(sessionId, tail);
    await previous.catch(() => undefined);
    try {
      const result = await this.#executePromptUnlocked(prompt, sessionId, inherited);
      if (isStream(result)) {
        void result.completed.finally(release);
      } else {
        release();
      }
      void tail.finally(() => {
        if (this.#sessionTails.get(sessionId) === tail) this.#sessionTails.delete(sessionId);
      });
      return result;
    } catch (error) {
      release();
      throw error;
    }
  }

  async #executePromptUnlocked(
    prompt: string,
    sessionId: string,
    inherited: readonly Message[],
  ): Promise<InvokeResult> {
    await this.#memory.append(sessionId, { role: "user", content: prompt });
    const history = await this.#memory.get(sessionId);
    const messages = [...inherited, ...history];
    const adapter = this.#definition.config.modelAdapter ?? new XsaiModelAdapter();
    const request = this.#request(messages, sessionId);

    if ((this.#definition.config.stream ?? true) && adapter.stream) {
      const response = await adapter.stream(request);
      return this.#streamResult(response, sessionId);
    }

    const response = await adapter.generate(request);
    await this.#memory.append(sessionId, {
      role: "assistant",
      content: response.text,
    });
    return response.usage
      ? { text: response.text, usage: response.usage }
      : { text: response.text };
  }

  #streamResult(response: ModelStreamResponse, sessionId: string): AgentStreamResult {
    let resolveCompleted: ((result: AgentResult) => void) | undefined;
    let rejectCompleted: ((error: unknown) => void) | undefined;
    const completed = new Promise<AgentResult>((resolve, reject) => {
      resolveCompleted = resolve;
      rejectCompleted = reject;
    });
    const memory = this.#memory;
    const stream = (async function* () {
      let text = "";
      try {
        for await (const chunk of response.textStream) {
          text += chunk;
          yield chunk;
        }
        const usage = await response.usage;
        await memory.append(sessionId, { role: "assistant", content: text });
        resolveCompleted?.(usage ? { text, usage } : { text });
      } catch (error) {
        rejectCompleted?.(error);
        throw error;
      }
    })();
    return { textStream: stream, completed };
  }

  #request(messages: readonly Message[], sessionId: string): ModelRequest {
    const tools = [
      ...this.#definition.tools,
      ...this.#delegateTools(sessionId, messages),
      ...this.#mcpTools,
    ].map((tool) =>
      toModelTool(tool, {
        sessionId,
        events: this.#definition.events,
        ...(this.#sandbox ? { defaultSandbox: this.#sandbox } : {}),
      }),
    );
    return {
      model: this.#definition.config.model,
      baseURL: this.#definition.config.baseURL,
      apiKey: this.#definition.config.apiKey,
      messages: [{ role: "system", content: this.#definition.config.persona }, ...messages],
      tools,
      maxSteps: this.#definition.config.maxSteps ?? 3,
      reasoning: this.#definition.config.reasoning ?? "none",
    };
  }

  #delegateTools(sessionId: string, parentMessages: readonly Message[]): ToolConfig[] {
    const events = this.#definition.events;
    return [...this.#delegates.entries()].map(([name, registration]) => ({
      name,
      description: registration.agent.description ?? `Delegate a task to ${name}`,
      input: delegateSchema(),
      ...(registration.options.approval ? { approval: registration.options.approval } : {}),
      ...(registration.options.sandbox ? { sandbox: registration.options.sandbox } : {}),
      async execute(input: { readonly prompt: string }) {
        await events.emit({
          type: "delegate.started",
          delegate: name,
          sessionId,
        });
        try {
          const result = await registration.agent.#executePrompt(
            input.prompt,
            `${sessionId}:delegate:${name}`,
            registration.options.passContext ? parentMessages : [],
          );
          return await collect(result);
        } finally {
          await events.emit({
            type: "delegate.completed",
            delegate: name,
            sessionId,
          });
        }
      },
    }));
  }

  async #startResource(resource: ResourceDefinition): Promise<void> {
    switch (resource.type) {
      case "sandbox":
        this.#sandbox = resource.value;
        if (resource.value.close)
          this.#startedResources.push(() => resource.value.close?.() ?? Promise.resolve());
        break;
      case "memory":
        this.#memory = resource.value;
        if (resource.value.close)
          this.#startedResources.push(() => resource.value.close?.() ?? Promise.resolve());
        break;
      case "channel": {
        if (resource.value.close)
          this.#startedResources.push(() => resource.value.close?.() ?? Promise.resolve());
        const dispatch = async (message: { readonly sessionId: string; readonly text: string }) => {
          const result = await this.invoke(message.text, message.sessionId);
          await resource.value.send(
            message.sessionId,
            isStream(result) ? result.textStream : result.text,
          );
          await this.#definition.events.emit({
            type: "message.sent",
            channel: resource.value.name,
            sessionId: message.sessionId,
          });
        };
        await resource.value.listen({
          app: this.app,
          onMessage(_handler) {},
          dispatch,
          emit: (event) => this.#definition.events.emit(event).then(() => undefined),
        });
        break;
      }
      case "mcp": {
        if (resource.value.close)
          this.#startedResources.push(() => resource.value.close?.() ?? Promise.resolve());
        const connection = await resource.value.connect({
          emit: (event) => this.#definition.events.emit(event).then(() => undefined),
        });
        if (connection) this.#mcpConnections.push(connection);
        for (const tool of connection?.tools ?? []) {
          if (this.#modelToolNames.has(tool.name))
            throw new Error(`Duplicate model-visible tool name: ${tool.name}`);
          this.#modelToolNames.add(tool.name);
          this.#mcpTools.push({
            ...tool,
            approval: tool.approval ?? (resource.value.trust === "trusted" ? "auto" : "human"),
          } as McpToolDefinition);
        }
        await this.#definition.events.emit({
          type: "mcp.connected",
          server: resource.value.name,
        });
        break;
      }
      case "delegate":
        await resource.value.agent.start();
        this.#startedResources.push(() => resource.value.agent.stop());
        break;
      case "serve": {
        const { driver, ...config } = resource.value;
        const tools = this.#request([], "serve").tools;
        if (driver) {
          if (driver.close)
            this.#startedResources.push(() => driver.close?.() ?? Promise.resolve());
          await driver.start({ config, tools, app: this.app });
          break;
        }
        this.#startedResources.push(() => this.backbone.close());
        await this.backbone.mountMcp({
          name: config.name ?? this.name ?? "xsaf",
          version: config.version ?? "0.1.0-alpha.0",
          path: config.path ?? "/mcp",
          tools,
        });
        break;
      }
      case "schedule": {
        const scheduler = this.#definition.config.scheduler ?? new CronScheduler();
        const task = await scheduler.schedule(resource.value, () =>
          this.#runSchedule(resource.value),
        );
        this.#startedResources.push(() => task.close());
        break;
      }
    }
  }

  async #runSchedule(schedule: ScheduleConfig): Promise<void> {
    const sessionId = schedule.sessionId ?? `heartbeat:${schedule.cron}`;
    await this.#definition.events.emit({ type: "heartbeat.fired", sessionId });
    try {
      const prompt =
        typeof schedule.prompt === "string" ? schedule.prompt : await schedule.prompt();
      const target = schedule.delegate ? this.#delegates.get(schedule.delegate)?.agent : this;
      if (!target) throw new Error(`Unknown scheduled delegate: ${schedule.delegate}`);
      const result = await collect(await target.#executePrompt(prompt, sessionId));
      await schedule.onResult?.(result);
      await this.#definition.events.emit({
        type: "heartbeat.completed",
        sessionId,
      });
    } catch (error) {
      await this.#definition.events.emit({
        type: "heartbeat.failed",
        sessionId,
        error: error instanceof Error ? error.message : "Heartbeat failed",
      });
      throw error;
    }
  }

  async #closeStarted(): Promise<void> {
    const resources = this.#startedResources.splice(0).reverse();
    const errors: unknown[] = [];
    for (const close of resources) {
      try {
        await close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0)
      throw new AggregateError(errors, "One or more XSAF resources failed to close");
    this.#mcpTools.length = 0;
    this.#mcpConnections.length = 0;
    this.#modelToolNames.clear();
    for (const tool of this.#definition.tools) this.#modelToolNames.add(tool.name);
    for (const name of this.#delegates.keys()) this.#modelToolNames.add(name);
  }

  #assertStarted(): void {
    if (this.#state !== "started") throw new Error("Agent must be started before invocation");
  }
}
