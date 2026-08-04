import type { StandardSchemaV1, XsafToolSchema } from "../standard-schema";
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
  XsafSchedulerDriver,
} from "../types";
import { AgentRuntime } from "./agent";
/** The single fluent configuration and runtime object returned by `agent()`. */
export declare class XsafAgent {
  #private;
  constructor(config: AgentConfig);
  tool<Schema extends XsafToolSchema>(config: ToolConfig<Schema>): this;
  delegate(agent: XsafAgent, options?: DelegateOptions): this;
  sandbox(driver: XsafSandboxDriver): this;
  memory(driver: XsafMemoryDriver): this;
  channel(driver: XsafChannelDriver): this;
  mcp(driver: XsafMcpDriver): this;
  scheduler(driver: XsafSchedulerDriver): this;
  serve(config?: ServeConfig): this;
  schedule(config: ScheduleConfig): this;
  on<Type extends EventType>(type: Type, handler: EventHandler<Type>): this;
  approve(handler: HumanApprovalHandler): this;
  start(): Promise<this>;
  stop(): Promise<void>;
  invoke(prompt: string, sessionId?: string): Promise<InvokeResult>;
  ask<Output>(
    prompt: string,
    schema: StandardSchemaV1<unknown, Output>,
    sessionId?: string,
  ): Promise<Output>;
  prompt(name: string, args?: Readonly<Record<string, unknown>>): Promise<string>;
  get name(): string | undefined;
  get description(): string | undefined;
  get started(): boolean;
  get app(): AgentRuntime["app"];
  fetch(request: Request): Promise<Response>;
  get channels(): ReadonlyMap<string, XsafChannelDriver>;
}
/** Create a fluent agent. Methods configure only; I/O and timers begin at `.start()`. */
export declare function agent(config: AgentConfig): XsafAgent;
