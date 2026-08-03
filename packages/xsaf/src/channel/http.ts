import { ORPCError, eventIterator, os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type { Context } from "hono";
import type { StandardSchemaV1 } from "../standard-schema";
import type {
  ChannelContext,
  ChannelPayload,
  ChannelTarget,
  EventType,
  XsafChannelDriver,
  XsafEvent,
} from "../types";

export interface HttpChannelOptions {
  readonly name?: string;
  readonly path?: string;
  /** Optional bearer token required by the chat endpoint. */
  readonly apiKey?: string;
}

type Pending = {
  resolve(payload: ChannelPayload): void;
  reject(error: unknown): void;
};

type ChatInput = {
  readonly text: string;
  readonly sessionId?: string;
};

type ChatEvent =
  | Extract<
      XsafEvent,
      {
        readonly type:
          | "tool.called"
          | "tool.completed"
          | "tool.failed"
          | "delegate.started"
          | "delegate.completed"
          | "approval.required"
          | "approval.granted";
      }
    >
  | { readonly type: "message.delta"; readonly text: string }
  | { readonly type: "message.completed"; readonly sessionId: string };

const forwardedEvents = [
  "tool.called",
  "tool.completed",
  "tool.failed",
  "delegate.started",
  "delegate.completed",
  "approval.required",
  "approval.granted",
] as const satisfies readonly EventType[];

function schema<Output>(
  validate: (value: unknown) => value is Output,
  message: string,
): StandardSchemaV1<unknown, Output> {
  return {
    "~standard": {
      version: 1,
      vendor: "xsaf",
      validate(value) {
        return validate(value) ? { value } : { issues: [{ message }] };
      },
    },
  };
}

function isChatInput(value: unknown): value is ChatInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input["text"] === "string" &&
    input["text"].trim().length > 0 &&
    (input["sessionId"] === undefined || typeof input["sessionId"] === "string")
  );
}

function isChatEvent(value: unknown): value is ChatEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (typeof event["type"] !== "string") return false;
  switch (event["type"]) {
    case "message.delta":
      return typeof event["text"] === "string";
    case "message.completed":
      return typeof event["sessionId"] === "string";
    case "tool.called":
    case "tool.completed":
      return typeof event["tool"] === "string" && typeof event["sessionId"] === "string";
    case "tool.failed":
      return (
        typeof event["tool"] === "string" &&
        typeof event["sessionId"] === "string" &&
        typeof event["error"] === "string"
      );
    case "delegate.started":
    case "delegate.completed":
      return typeof event["delegate"] === "string" && typeof event["sessionId"] === "string";
    case "approval.required":
    case "approval.granted":
      return typeof event["tool"] === "string" && typeof event["sessionId"] === "string";
    default:
      return false;
  }
}

const chatInputSchema = schema(isChatInput, "Expected a non-empty text and optional sessionId");
const chatEventSchema = schema(isChatEvent, "Invalid XSAF chat event");

class AsyncQueue<Value> implements AsyncIterableIterator<Value> {
  readonly #values: Value[] = [];
  readonly #waiters: Array<{
    resolve(result: IteratorResult<Value>): void;
    reject(error: unknown): void;
  }> = [];
  #closed = false;
  #error: unknown;

  push(value: Value): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.#values.push(value);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
  }

  fail(error: unknown): void {
    if (this.#closed) return;
    this.#error = error;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }

  next(): Promise<IteratorResult<Value>> {
    const value = this.#values.shift();
    if (value !== undefined) return Promise.resolve({ value, done: false });
    if (this.#error !== undefined) return Promise.reject(this.#error);
    if (this.#closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this.#waiters.push({ resolve, reject }));
  }

  return(): Promise<IteratorResult<Value>> {
    this.close();
    return Promise.resolve({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<Value> {
    return this;
  }
}

/** Fetch-native oRPC Event Iterator channel mounted on the agent's shared Hono app. */
class HttpChannel implements XsafChannelDriver {
  readonly name: string;
  readonly path: string;
  readonly #apiKey: string | undefined;
  readonly #pending = new Map<string, Pending[]>();
  #closed = false;

  constructor(options: HttpChannelOptions = {}) {
    this.name = options.name ?? "http";
    this.path = options.path ?? "/chat";
    this.#apiKey = options.apiKey;
  }

  listen(context: ChannelContext): void {
    const channel = this;
    const procedure = os
      .$context<{ readonly authorization: string | null }>()
      .use(({ context: requestContext, next }) => {
        if (channel.#apiKey && requestContext.authorization !== `Bearer ${channel.#apiKey}`) {
          throw new ORPCError("UNAUTHORIZED");
        }
        return next();
      })
      .input(chatInputSchema)
      .output(eventIterator(chatEventSchema))
      .handler(async function* ({ input }) {
        if (channel.#closed) throw new ORPCError("SERVICE_UNAVAILABLE");
        const sessionId = input.sessionId || crypto.randomUUID();
        const queue = new AsyncQueue<ChatEvent>();
        const payload = channel.#waitForPayload(sessionId);
        const unsubscribe = forwardedEvents.map((type) =>
          context.on(type, (event) => {
            if (event.sessionId === sessionId || event.sessionId.startsWith(`${sessionId}:`))
              queue.push(event);
          }),
        );

        void (async () => {
          try {
            await context.dispatch({ sessionId, text: input.text });
            const result = await payload;
            if (typeof result === "string") {
              queue.push({ type: "message.delta", text: result });
            } else if (Symbol.asyncIterator in result) {
              for await (const chunk of result) queue.push({ type: "message.delta", text: chunk });
            } else {
              queue.push({ type: "message.delta", text: result.text });
            }
            queue.push({ type: "message.completed", sessionId });
            queue.close();
          } catch (error) {
            channel.#shift(sessionId);
            queue.fail(error);
          }
        })();

        try {
          yield* queue;
        } finally {
          for (const stop of unsubscribe) stop();
          channel.#shift(sessionId);
          queue.close();
        }
      });

    const handler = new RPCHandler(procedure);
    const handle = async (requestContext: Context) => {
      const { matched, response } = await handler.handle(requestContext.req.raw, {
        prefix: this.path as `/${string}`,
        context: { authorization: requestContext.req.header("authorization") ?? null },
      });
      if (!matched) return requestContext.json({ error: "Not Found" }, 404);
      return requestContext.newResponse(response.body, response);
    };

    context.app.all(this.path, handle);
    context.app.all(`${this.path}/*`, handle);
  }

  async send(target: ChannelTarget, payload: ChannelPayload): Promise<void> {
    if (typeof target !== "string") throw new TypeError("HTTP channel targets must be session IDs");
    const pending = this.#shift(target);
    if (!pending) throw new Error(`No pending HTTP request for session ${target}`);
    pending.resolve(payload);
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const queue of this.#pending.values())
      for (const pending of queue) pending.reject(new Error("HTTP channel closed"));
    this.#pending.clear();
  }

  #waitForPayload(sessionId: string): Promise<ChannelPayload> {
    return new Promise((resolve, reject) => {
      const queue = this.#pending.get(sessionId) ?? [];
      queue.push({ resolve, reject });
      this.#pending.set(sessionId, queue);
    });
  }

  #shift(sessionId: string): Pending | undefined {
    const queue = this.#pending.get(sessionId);
    const pending = queue?.shift();
    if (queue?.length === 0) this.#pending.delete(sessionId);
    return pending;
  }
}

export default function http(options?: HttpChannelOptions): HttpChannel {
  return new HttpChannel(options);
}
