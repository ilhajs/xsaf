import type { Hono } from "hono";
import type { StandardSchemaV1, XsafToolSchema } from "./standard-schema";

export type MaybePromise<T> = T | Promise<T>;

export interface Message {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly name?: string;
  readonly toolCallId?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface InboundMessage {
  readonly sessionId: string;
  readonly text: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export type ChannelTarget = string | Readonly<Record<string, unknown>>;
export type ChannelPayload =
  | string
  | AsyncIterable<string>
  | {
      readonly text: string;
      readonly meta?: unknown;
    };

export interface ChannelContext {
  /** Shared Hono request backbone for HTTP-capable channels. */
  readonly app: Hono;
  /** Delivers an inbound message into the agent's unified request path. */
  dispatch(message: InboundMessage): Promise<void>;
  /** Observes lifecycle events, returning an unsubscribe function. */
  on<Type extends EventType>(type: Type, handler: EventHandler<Type>): () => void;
  emit(event: XsafEvent): Promise<void>;
}

export interface XsafChannelDriver {
  readonly name: string;
  listen(context: ChannelContext): MaybePromise<void>;
  send(target: ChannelTarget, payload: ChannelPayload): Promise<void>;
  close?(): Promise<void>;
}

export interface XsafMemoryDriver {
  get(sessionId: string): Promise<Message[]>;
  append(sessionId: string, message: Message): Promise<void>;
  clear(sessionId: string): Promise<void>;
  close?(): Promise<void>;
}

export interface SandboxPermissions {
  readonly fs?: boolean | readonly string[];
  readonly network?: boolean | readonly string[];
  readonly shell?: boolean;
}

export interface XsafSandboxDriver {
  readonly name: string;
  readonly permissions?: SandboxPermissions;
  run(
    fn: (...args: unknown[]) => Promise<unknown>,
    args: unknown[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
  close?(): Promise<void>;
}

export interface ModelTool {
  readonly name: string;
  readonly description: string;
  readonly input: XsafToolSchema;
  execute(input: unknown, options?: { readonly signal?: AbortSignal }): Promise<unknown>;
}

export interface ModelRequest {
  readonly model: string;
  readonly baseURL: string;
  readonly apiKey: string;
  readonly messages: readonly Message[];
  readonly tools: readonly ModelTool[];
  readonly maxSteps: number;
  readonly reasoning: "none" | "low" | "high";
}

export interface ModelResponse {
  readonly text: string;
  readonly usage?: Readonly<Record<string, number>>;
  readonly raw?: unknown;
}

export interface ModelStreamResponse {
  readonly textStream: AsyncIterable<string>;
  readonly usage?: Promise<Readonly<Record<string, number>> | undefined>;
  readonly raw?: unknown;
}

export interface XsafModelAdapter {
  generate(request: ModelRequest): Promise<ModelResponse>;
  stream?(request: ModelRequest): ModelStreamResponse | Promise<ModelStreamResponse>;
  ask?<Output>(request: ModelRequest, schema: StandardSchemaV1<unknown, Output>): Promise<Output>;
}

export interface XsafModel {
  readonly name: string;
  readonly adapter: XsafModelAdapter;
  readonly baseURL?: string;
  readonly apiKey?: string;
}

export type ApprovalFn<Input = unknown> = {
  bivarianceHack(
    input: Input,
    context: { readonly tool: string; readonly sessionId: string },
  ): MaybePromise<boolean>;
}["bivarianceHack"];
export type Approval<Input = unknown> = "auto" | "human" | ApprovalFn<Input>;
export type HumanApprovalHandler = ApprovalFn<unknown>;

export interface ToolConfig<Schema extends XsafToolSchema = XsafToolSchema> {
  readonly name: string;
  readonly description: string;
  readonly input: Schema;
  execute(
    input: StandardSchemaV1.InferOutput<Schema>,
    context: ToolExecutionContext,
  ): MaybePromise<unknown>;
  readonly approval?: Approval<StandardSchemaV1.InferOutput<Schema>>;
  readonly retries?: number;
  readonly onError?: (error: unknown) => MaybePromise<unknown>;
  readonly timeout?: number;
  readonly sandbox?: XsafSandboxDriver;
}

export interface ToolExecutionContext {
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}

export interface AgentConfig {
  /** Stable snake_case identity used by delegates, MCP, and presentation adapters. */
  readonly name?: string;
  readonly description?: string;
  readonly model: XsafModel;
  readonly persona: string;
  readonly maxSteps?: number;
  readonly stream?: boolean;
  readonly reasoning?: "none" | "low" | "high";
}

export interface AgentResult {
  readonly text: string;
  readonly usage?: Readonly<Record<string, number>>;
}

export interface AgentStreamResult {
  readonly textStream: AsyncIterable<string>;
  readonly completed: Promise<AgentResult>;
}

export type InvokeResult = AgentResult | AgentStreamResult;

export interface DelegateOptions {
  readonly passContext?: boolean;
  readonly approval?: Approval<{ readonly prompt: string }>;
  readonly sandbox?: XsafSandboxDriver;
}

export interface McpToolDefinition extends Omit<ToolConfig, "approval"> {
  readonly approval?: Approval;
}

export interface McpConnection {
  readonly tools?: readonly McpToolDefinition[];
  readonly resources?: {
    get(uri: string): Promise<unknown>;
  };
  readonly prompts?: {
    get(name: string, args?: Readonly<Record<string, unknown>>): Promise<string>;
  };
}

export interface McpContext {
  emit(event: XsafEvent): Promise<void>;
}

export interface XsafMcpDriver {
  readonly name: string;
  readonly trust?: "trusted" | "untrusted";
  connect(context: McpContext): Promise<McpConnection | void>;
  close?(): Promise<void>;
}

export interface ServeConfig {
  readonly path?: string;
  readonly name?: string;
  readonly version?: string;
  /** Host for DNS rebinding protection (default: '127.0.0.1'). Use '0.0.0.0' to disable. */
  readonly host?: string;
  readonly allowedHosts?: readonly string[];
  readonly allowedOrigins?: readonly string[];
  /** Overrides the built-in Hono + MCP HTTP backbone. Required for stdio. */
  readonly driver?: XsafServeDriver;
}

export interface XsafServeDriver {
  start(context: {
    readonly config: Omit<ServeConfig, "driver">;
    readonly tools: readonly ModelTool[];
    readonly app: Hono;
  }): Promise<void>;
  close?(): Promise<void>;
}

export interface ScheduleConfig {
  readonly cron: string;
  readonly prompt: string | (() => Promise<string>);
  readonly sessionId?: string;
  readonly delegate?: string;
  readonly onResult?: (result: AgentResult) => Promise<void>;
  readonly timezone?: string;
  readonly runImmediately?: boolean;
}

export interface ScheduledTask {
  close(): Promise<void>;
}

export interface XsafSchedulerDriver {
  schedule(config: ScheduleConfig, run: () => Promise<void>): Promise<ScheduledTask>;
}

export type XsafEvent =
  | {
      readonly type: "tool.called";
      readonly tool: string;
      readonly sessionId: string;
    }
  | {
      readonly type: "tool.completed";
      readonly tool: string;
      readonly sessionId: string;
    }
  | {
      readonly type: "tool.failed";
      readonly tool: string;
      readonly sessionId: string;
      readonly error: string;
    }
  | {
      readonly type: "delegate.started";
      readonly delegate: string;
      readonly sessionId: string;
    }
  | {
      readonly type: "delegate.completed";
      readonly delegate: string;
      readonly sessionId: string;
    }
  | {
      readonly type: "message.sent";
      readonly channel?: string;
      readonly sessionId: string;
    }
  | {
      readonly type: "approval.required";
      readonly tool: string;
      readonly sessionId: string;
    }
  | {
      readonly type: "approval.granted";
      readonly tool: string;
      readonly sessionId: string;
    }
  | { readonly type: "mcp.connected"; readonly server: string }
  | { readonly type: "heartbeat.fired"; readonly sessionId: string }
  | { readonly type: "heartbeat.completed"; readonly sessionId: string }
  | {
      readonly type: "heartbeat.failed";
      readonly sessionId: string;
      readonly error: string;
    }
  | {
      readonly type: "sandbox.escalated";
      readonly sandbox: string;
      readonly tool: string;
    }
  | {
      readonly type: "sandbox.denied";
      readonly sandbox: string;
      readonly tool: string;
      readonly reason: string;
    };

export type EventType = XsafEvent["type"];
export type EventFor<Type extends EventType> = Extract<XsafEvent, { readonly type: Type }>;
export type EventHandler<Type extends EventType> = (event: EventFor<Type>) => MaybePromise<unknown>;
