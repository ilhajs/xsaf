import type { EventBus } from "../events/event-bus";
import type { ModelTool, ToolConfig, XsafSandboxDriver } from "../types";
export declare class ToolValidationError extends Error {
  readonly issues: readonly unknown[];
  constructor(tool: string, issues: readonly unknown[]);
}
export declare class ToolApprovalError extends Error {
  constructor(tool: string);
}
export declare class ToolTimeoutError extends Error {
  constructor(tool: string, timeout: number);
}
export declare class ToolSandboxRequiredError extends Error {
  constructor(tool: string);
}
export declare function toModelTool(
  config: ToolConfig,
  context: {
    readonly sessionId: string;
    readonly events: EventBus;
    readonly defaultSandbox?: XsafSandboxDriver;
  },
): ModelTool;
