import type { EventBus } from "../events/event-bus";
import type { Approval, ModelTool, ToolConfig, XsafSandboxDriver } from "../types";

export class ToolValidationError extends Error {
  readonly issues: readonly unknown[];

  constructor(tool: string, issues: readonly unknown[]) {
    super(`Invalid input for tool "${tool}"`);
    this.name = "ToolValidationError";
    this.issues = issues;
  }
}

export class ToolApprovalError extends Error {
  constructor(tool: string) {
    super(`Approval denied for tool "${tool}"`);
    this.name = "ToolApprovalError";
  }
}

export class ToolTimeoutError extends Error {
  constructor(tool: string, timeout: number) {
    super(`Tool "${tool}" timed out after ${timeout}ms`);
    this.name = "ToolTimeoutError";
  }
}

export class ToolSandboxRequiredError extends Error {
  constructor(tool: string) {
    super(
      `Tool "${tool}" requires an explicit sandbox; use @xsaf/agent/sandbox/local({ unsafe: true }) to opt into no isolation`,
    );
    this.name = "ToolSandboxRequiredError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown tool error";
}

function isNonRetryable(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    error instanceof ToolTimeoutError ||
    error instanceof ToolSandboxRequiredError ||
    signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function combineSignals(
  first: AbortSignal | undefined,
  second: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!first) return second;
  if (!second) return first;
  return AbortSignal.any([first, second]);
}

async function approved(
  approval: Approval | undefined,
  input: unknown,
  tool: string,
  sessionId: string,
  events: EventBus,
): Promise<boolean> {
  if (!approval || approval === "auto") return true;

  await events.emit({
    type: "approval.required",
    tool,
    sessionId,
  });
  const accepted =
    approval === "human"
      ? await events.requestApproval(input, { tool, sessionId })
      : await approval(input, { tool, sessionId });

  if (accepted) await events.emit({ type: "approval.granted", tool, sessionId });
  return accepted;
}

async function withTimeout<T>(
  operation: (signal: AbortSignal | undefined) => Promise<T>,
  timeout: number | undefined,
  tool: string,
): Promise<T> {
  if (!timeout) return operation(undefined);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ToolTimeoutError(tool, timeout));
    }, timeout);
  });
  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function toModelTool(
  config: ToolConfig,
  context: {
    readonly sessionId: string;
    readonly events: EventBus;
    readonly defaultSandbox?: XsafSandboxDriver;
    readonly emitToolEvents?: boolean;
  },
): ModelTool {
  return {
    name: config.name,
    description: config.description,
    input: config.input,
    async execute(rawInput, options) {
      const validation = await config.input["~standard"].validate(rawInput);
      if (validation.issues) {
        throw new ToolValidationError(config.name, validation.issues);
      }
      const input = validation.value;
      if (
        !(await approved(config.approval, input, config.name, context.sessionId, context.events))
      ) {
        throw new ToolApprovalError(config.name);
      }

      const retries = config.retries ?? 0;
      let lastError: unknown;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        let executionSignal: AbortSignal | undefined;
        if (context.emitToolEvents !== false)
          await context.events.emit({
            type: "tool.called",
            tool: config.name,
            sessionId: context.sessionId,
          });
        try {
          const result = await withTimeout(
            async (timeoutSignal) => {
              const signal = combineSignals(timeoutSignal, options?.signal);
              executionSignal = signal;
              const execute = async (...args: unknown[]) =>
                config.execute(args[0] as never, {
                  sessionId: context.sessionId,
                  ...(signal ? { signal } : {}),
                });
              const sandbox = config.sandbox ?? context.defaultSandbox;
              if (!sandbox) throw new ToolSandboxRequiredError(config.name);
              return sandbox.run(execute, [input], signal ? { signal } : undefined);
            },
            config.timeout,
            config.name,
          );
          if (context.emitToolEvents !== false)
            await context.events.emit({
              type: "tool.completed",
              tool: config.name,
              sessionId: context.sessionId,
            });
          return result;
        } catch (error) {
          lastError = error;
          if (context.emitToolEvents !== false)
            await context.events.emit({
              type: "tool.failed",
              tool: config.name,
              sessionId: context.sessionId,
              error: errorMessage(error),
            });
          if (isNonRetryable(error, executionSignal)) break;
        }
      }

      if (config.onError) return config.onError(lastError);
      throw lastError;
    },
  };
}
