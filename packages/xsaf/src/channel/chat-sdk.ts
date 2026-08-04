/**
 * chat-sdk channel adapter for XSAF.
 *
 * Bridges any chat-sdk adapter (Slack, Teams, Discord, Google Chat, etc.) into
 * the XSAF agent runtime. Users create and configure the `Chat` instance
 * themselves — including adapters, state, and webhook routing — then pass it
 * to this driver. The driver registers inbound message handlers on the `Chat`
 * bot and posts outgoing payloads back through `bot.thread(target).post(...)`.
 *
 * `chat` is a **peer dependency** — install it alongside this package:
 *   bun add chat
 *
 * Security: thread IDs and message text arrive from external platforms and are
 * treated as untrusted. Do not log or forward them without sanitisation.
 *
 * @module
 */

import type { Chat, Channel, Message, Thread } from "chat";
import type { ChannelContext, ChannelPayload, ChannelTarget, XsafChannelDriver } from "../types";

// ── Options ──────────────────────────────────────────────────────────────────

export interface ChatSdkChannelOptions {
  /**
   * Channel driver name. Defaults to `"chat-sdk"`.
   */
  readonly name?: string;

  /**
   * Which inbound event types to listen for.
   * Defaults to all three: `["mention", "direct", "subscribed"]`.
   *
   * - `"mention"` — messages where the bot is @-mentioned in an unsubscribed thread
   * - `"direct"` — direct messages sent to the bot
   * - `"subscribed"` — messages in threads the bot has subscribed to
   */
  readonly listen?: ReadonlyArray<"mention" | "direct" | "subscribed">;

  /**
   * Derive the XSAF session ID from an inbound thread and message.
   *
   * Defaults to `thread.id`, which scopes each platform thread to its own
   * agent memory. Override to coalesce threads or map to user-level sessions.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly sessionId?: (thread: Thread<any>, message: Message) => string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveText(payload: ChannelPayload): string | AsyncIterable<string> {
  if (typeof payload === "string") return payload;
  if (Symbol.asyncIterator in (payload as object)) return payload as AsyncIterable<string>;
  return (payload as { readonly text: string }).text;
}

async function collectIterable(iter: AsyncIterable<string>): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of iter) chunks.push(chunk);
  return chunks.join("");
}

// ── Driver ───────────────────────────────────────────────────────────────────

/**
 * XSAF channel driver that bridges a chat-sdk `Chat` instance.
 *
 * The driver registers inbound handlers on `bot` at `listen()` time and
 * dispatches each incoming message into the XSAF request path. Outbound
 * payloads are posted back to the originating platform thread.
 *
 * The `send()` target must be a thread ID string (e.g. `"slack:C123:1234.567"`
 * as provided by chat-sdk's `thread.id`). Streaming `AsyncIterable<string>`
 * payloads are collected before posting because `thread.post()` accepts a
 * plain string or a `PostableMessage` — not a raw async iterable of chunks.
 *
 * chat-sdk already filters `isMe: true` messages before handlers run, so
 * bot self-replies do not loop back into XSAF.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class ChatSdkChannel implements XsafChannelDriver {
  readonly name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly #bot: Chat<any, any>;
  readonly #listenFor: ReadonlySet<"mention" | "direct" | "subscribed">;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly #sessionId: (thread: Thread<any>, message: Message) => string;
  #closed = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(bot: Chat<any, any>, options: ChatSdkChannelOptions = {}) {
    this.name = options.name ?? "chat-sdk";
    this.#bot = bot;
    this.#listenFor = new Set(options.listen ?? ["mention", "direct", "subscribed"]);
    this.#sessionId = options.sessionId ?? ((thread) => thread.id);
  }

  listen(context: ChannelContext): void {
    if (this.#closed) throw new Error("ChatSdkChannel is closed");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dispatch = async (thread: Thread<any>, message: Message): Promise<void> => {
      if (this.#closed) return;
      const text = message.text?.trim();
      if (!text) return;
      const sessionId = this.#sessionId(thread, message);
      try {
        await context.dispatch({ sessionId, text, meta: { threadId: thread.id } });
      } catch (error) {
        // context.dispatch (agent invoke + send) threw — post the error back so
        // the user sees something rather than the message being silently dropped
        // by the chat-sdk concurrency layer.
        const msg = error instanceof Error ? error.message : "An error occurred. Please try again.";
        try {
          await thread.post(msg);
        } catch {
          // best-effort; ignore secondary send failures
        }
      }
    };

    if (this.#listenFor.has("mention")) {
      this.#bot.onNewMention(dispatch);
    }
    if (this.#listenFor.has("direct")) {
      // onDirectMessage passes (thread, message, channel) — channel is unused here
      this.#bot.onDirectMessage(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (thread: Thread<any>, message: Message, _channel: Channel) => {
          await dispatch(thread, message);
        },
      );
    }
    if (this.#listenFor.has("subscribed")) {
      this.#bot.onSubscribedMessage(dispatch);
    }
  }

  async send(target: ChannelTarget, payload: ChannelPayload): Promise<void> {
    if (this.#closed) throw new Error("ChatSdkChannel is closed");
    if (typeof target !== "string") {
      throw new TypeError(
        'ChatSdkChannel target must be a thread ID string (e.g. "slack:C123:1234.567")',
      );
    }

    const resolved = resolveText(payload);
    const text = typeof resolved === "string" ? resolved : await collectIterable(resolved);

    if (!text) return;
    await this.#bot.thread(target).post(text);
  }

  async close(): Promise<void> {
    this.#closed = true;
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a chat-sdk channel driver.
 *
 * @param bot - A configured `Chat` instance from the `chat` package.
 * @param options - Optional driver configuration.
 *
 * @example
 * ```ts
 * import { Chat } from "chat";
 * import { createSlackAdapter } from "@chat-adapter/slack";
 * import { createRedisState } from "@chat-adapter/state-redis";
 * import chatSdk from "@xsaf/agent/channel/chat-sdk";
 *
 * const bot = new Chat({
 *   userName: "mybot",
 *   adapters: { slack: createSlackAdapter() },
 *   state: createRedisState(),
 * });
 *
 * // Wire webhooks to your HTTP framework separately:
 * // app.post("/webhooks/slack", bot.webhooks.slack);
 *
 * const agent = xsaf
 *   .agent({ name: "mybot", model })
 *   .channel(chatSdk(bot))
 *   .start();
 * ```
 */
export default function chatSdk(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot: Chat<any, any>,
  options?: ChatSdkChannelOptions,
): ChatSdkChannel {
  return new ChatSdkChannel(bot, options);
}
