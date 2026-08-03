import {
  generateObject,
  generateText,
  stepCountAtLeast,
  streamText,
  type Message as XsaiMessage,
  type Tool as XsaiTool,
  type ToolExecuteResult,
} from "xsai";
import type { StandardSchemaV1 } from "../standard-schema";
import type {
  Message,
  ModelRequest,
  ModelResponse,
  ModelStreamResponse,
  XsafModelAdapter,
} from "../types";

function toXsaiMessages(messages: readonly Message[]): XsaiMessage[] {
  return messages.map((message): XsaiMessage => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: message.content,
        tool_call_id: message.toolCallId ?? "xsaf",
      };
    }
    return { role: message.role, content: message.content };
  });
}

function toolResult(value: unknown): ToolExecuteResult {
  if (
    typeof value === "string" ||
    Array.isArray(value) ||
    (typeof value === "object" && value !== null)
  ) {
    return value;
  }
  return JSON.stringify(value);
}

function toXsaiTools(request: ModelRequest): XsaiTool[] {
  return request.tools.map(
    (tool): XsaiTool => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input["~standard"].jsonSchema.input({
          target: "draft-07",
        }),
        strict: true,
      },
      validate: async (input) => {
        const result = await tool.input["~standard"].validate(input);
        return result.issues
          ? {
              issues: result.issues.map((issue) => ({
                message: issue.message,
              })),
            }
          : { value: result.value };
      },
      execute: async (input, options) =>
        toolResult(
          await tool.execute(
            input,
            options.abortSignal ? { signal: options.abortSignal } : undefined,
          ),
        ),
    }),
  );
}

function common(request: ModelRequest) {
  return {
    apiKey: request.apiKey,
    baseURL: request.baseURL,
    model: request.model,
    messages: toXsaiMessages(request.messages),
    tools: toXsaiTools(request),
    stopWhen: stepCountAtLeast(request.maxSteps),
    reasoningEffort: request.reasoning === "low" ? ("minimal" as const) : request.reasoning,
  };
}

async function* readableToAsyncIterable(stream: ReadableStream<string>): AsyncIterable<string> {
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

export class XsaiModelAdapter implements XsafModelAdapter {
  async generate(request: ModelRequest): Promise<ModelResponse> {
    const result = await generateText(common(request));
    return {
      text: result.text ?? "",
      usage: {
        inputTokens: result.totalUsage.inputTokens,
        outputTokens: result.totalUsage.outputTokens,
        totalTokens: result.totalUsage.totalTokens,
      },
      raw: result,
    };
  }

  stream(request: ModelRequest): ModelStreamResponse {
    const result = streamText(common(request));
    return {
      textStream: readableToAsyncIterable(result.textStream),
      usage: result.totalUsage.then((usage) =>
        usage
          ? {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
            }
          : undefined,
      ),
      raw: result,
    };
  }

  async ask<Output>(
    request: ModelRequest,
    schema: StandardSchemaV1<unknown, Output>,
  ): Promise<Output> {
    const result = await generateObject({ ...common(request), schema });
    return result.object as Output;
  }
}
