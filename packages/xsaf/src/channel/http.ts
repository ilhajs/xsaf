import { streamSSE } from "hono/streaming";
import type { ChannelContext, ChannelPayload, ChannelTarget, XsafChannelDriver } from "../types";

export interface HttpChannelOptions {
  readonly name?: string;
  readonly path?: string;
}

type Pending = {
  resolve(payload: ChannelPayload): void;
  reject(error: unknown): void;
};

/** Fetch-native HTTP channel mounted on the agent's shared Hono app. */
class HttpChannel implements XsafChannelDriver {
  readonly name: string;
  readonly path: string;
  readonly #pending = new Map<string, Pending[]>();
  #closed = false;

  constructor(options: HttpChannelOptions = {}) {
    this.name = options.name ?? "http";
    this.path = options.path ?? "/chat";
  }

  listen(context: ChannelContext): void {
    context.app.post(this.path, async (requestContext) => {
      if (this.#closed) return requestContext.json({ error: "HTTP channel is closed" }, 503);
      const body = await requestContext.req.json<{
        sessionId?: unknown;
        text?: unknown;
      }>();
      if (typeof body.text !== "string" || body.text.trim().length === 0)
        return requestContext.json({ error: "text must be a non-empty string" }, 400);
      const sessionId =
        typeof body.sessionId === "string" && body.sessionId.length > 0
          ? body.sessionId
          : crypto.randomUUID();
      const payload = new Promise<ChannelPayload>((resolve, reject) => {
        const queue = this.#pending.get(sessionId) ?? [];
        queue.push({ resolve, reject });
        this.#pending.set(sessionId, queue);
      });
      try {
        await context.dispatch({ sessionId, text: body.text });
        const result = await payload;
        if (typeof result === "string") return requestContext.json({ text: result, sessionId });
        if (Symbol.asyncIterator in result) {
          return streamSSE(requestContext, async (stream) => {
            for await (const chunk of result) await stream.writeSSE({ data: chunk });
          });
        }
        return requestContext.json({ ...result, sessionId });
      } catch (error) {
        this.#shift(sessionId);
        throw error;
      }
    });
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
