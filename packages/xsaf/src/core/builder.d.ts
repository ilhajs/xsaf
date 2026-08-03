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
} from "../types";
import { XsafAgent } from "./agent";
export declare class XsafBuilder {
  #private;
  constructor(config: AgentConfig);
  tool<Schema extends XsafToolSchema>(config: ToolConfig<Schema>): this;
  delegate(agent: XsafAgent, options?: DelegateOptions): this;
  sandbox(driver: XsafSandboxDriver): this;
  memory(driver: XsafMemoryDriver): this;
  channel(driver: XsafChannelDriver): this;
  mcp(driver: XsafMcpDriver): this;
  serve(config: ServeConfig): this;
  schedule(config: ScheduleConfig): this;
  on<Type extends EventType>(type: Type, handler: EventHandler<Type>): this;
  /** Registers a privileged handler that may inspect validated tool arguments. */
  approve(handler: HumanApprovalHandler): this;
  asAgent(name?: string | undefined, description?: string | undefined): XsafAgent;
  start(): Promise<XsafAgent>;
  stop(): Promise<void>;
  invoke(prompt: string, sessionId?: string): Promise<InvokeResult>;
  run(prompt: string, sessionId?: string): Promise<InvokeResult>;
  ask<Output>(
    prompt: string,
    schema: StandardSchemaV1<unknown, Output>,
    sessionId?: string,
  ): Promise<Output>;
  get name(): string | undefined;
  get description(): string | undefined;
  get app(): XsafAgent["app"];
  fetch(request: Request): Promise<Response>;
  get channels(): ReadonlyMap<string, XsafChannelDriver>;
}
export declare const xsaf: {
  agent(config: AgentConfig): XsafBuilder;
};
