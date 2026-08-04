import type { Storage } from "unstorage";
import type { Message, XsafMemoryDriver } from "../types";

const KEY_PREFIX = "xsaf:session:";
const ROLES = new Set<Message["role"]>(["system", "user", "assistant", "tool"]);

export interface UnstorageMemoryOptions {
  /**
   * When true (default), `close()` calls `storage.dispose()`.
   * Set false if the Storage instance is shared beyond this agent.
   */
  readonly dispose?: boolean;
}

function keyFor(sessionId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(sessionId)}`;
}

function parseMessages(value: unknown): Message[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new TypeError("Unstorage memory payload must be a Message array");
  }

  return value.map((item, index) => {
    if (item === null || typeof item !== "object") {
      throw new TypeError(`Unstorage memory message at index ${index} is invalid`);
    }
    const record = item as Record<string, unknown>;
    const role = record["role"];
    const content = record["content"];
    const name = record["name"];
    const toolCallId = record["toolCallId"];
    const meta = record["meta"];

    if (typeof role !== "string" || !ROLES.has(role as Message["role"])) {
      throw new TypeError(`Unstorage memory message at index ${index} has an invalid role`);
    }
    if (typeof content !== "string") {
      throw new TypeError(`Unstorage memory message at index ${index} has invalid content`);
    }
    if (meta !== undefined && (meta === null || typeof meta !== "object" || Array.isArray(meta))) {
      throw new TypeError(`Unstorage memory message at index ${index} has invalid meta`);
    }

    return {
      role: role as Message["role"],
      content,
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof toolCallId === "string" ? { toolCallId } : {}),
      ...(meta !== undefined ? { meta: meta as Readonly<Record<string, unknown>> } : {}),
    };
  });
}

class UnstorageMemory implements XsafMemoryDriver {
  readonly #storage: Storage;
  readonly #disposeOnClose: boolean;

  constructor(storage: Storage, options?: UnstorageMemoryOptions) {
    this.#storage = storage;
    this.#disposeOnClose = options?.dispose ?? true;
  }

  async get(sessionId: string): Promise<Message[]> {
    const value = await this.#storage.getItem(keyFor(sessionId));
    return parseMessages(value);
  }

  async append(sessionId: string, message: Message): Promise<void> {
    const messages = await this.get(sessionId);
    messages.push(message);
    await this.#storage.setItem(keyFor(sessionId), messages);
  }

  async clear(sessionId: string): Promise<void> {
    await this.#storage.removeItem(keyFor(sessionId));
  }

  async close(): Promise<void> {
    if (this.#disposeOnClose) await this.#storage.dispose();
  }
}

/** Wrap an [unstorage](https://unstorage.unjs.io/) `Storage` as an `XsafMemoryDriver`. */
export function unstorage(storage: Storage, options?: UnstorageMemoryOptions): XsafMemoryDriver {
  return new UnstorageMemory(storage, options);
}
