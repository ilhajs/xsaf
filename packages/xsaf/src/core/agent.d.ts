import type { StandardSchemaV1 } from "../standard-schema";
import { HonoBackbone } from "../backbone/hono";
import type { EventBus } from "../events/event-bus";
import type {
  AgentConfig,
  DelegateOptions,
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
export type ResourceDefinition =
  | {
      readonly type: "sandbox";
      readonly value: XsafSandboxDriver;
    }
  | {
      readonly type: "memory";
      readonly value: XsafMemoryDriver;
    }
  | {
      readonly type: "channel";
      readonly value: XsafChannelDriver;
    }
  | {
      readonly type: "mcp";
      readonly value: XsafMcpDriver;
    }
  | {
      readonly type: "delegate";
      readonly value: DelegateRegistration;
    }
  | {
      readonly type: "serve";
      readonly value: ServeConfig;
    }
  | {
      readonly type: "schedule";
      readonly value: ScheduleConfig;
    };
export interface DelegateRegistration {
  readonly agent: AgentRuntime;
  readonly options: DelegateOptions;
}
export interface AgentDefinition {
  readonly config: AgentConfig;
  readonly tools: readonly ToolConfig[];
  readonly resources: readonly ResourceDefinition[];
  readonly events: EventBus;
  readonly scheduler?: XsafSchedulerDriver;
  readonly name?: string;
  readonly description?: string;
}
export declare class AgentRuntime {
  #private;
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly channels: ReadonlyMap<string, XsafChannelDriver>;
  readonly backbone: HonoBackbone;
  constructor(definition: AgentDefinition);
  get started(): boolean;
  get app(): HonoBackbone["app"];
  fetch(request: Request): Promise<Response>;
  start(): Promise<this>;
  stop(): Promise<void>;
  invoke(prompt: string, sessionId?: string): Promise<InvokeResult>;
  ask<Output>(
    prompt: string,
    schema: StandardSchemaV1<unknown, Output>,
    sessionId?: string,
  ): Promise<Output>;
  prompt(name: string, args?: Readonly<Record<string, unknown>>): Promise<string>;
}
