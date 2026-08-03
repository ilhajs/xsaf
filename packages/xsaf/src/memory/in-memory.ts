import type { Message, XsafMemoryDriver } from "../types";

export class InMemoryMemory implements XsafMemoryDriver {
  readonly #sessions = new Map<string, Message[]>();

  async get(sessionId: string): Promise<Message[]> {
    return [...(this.#sessions.get(sessionId) ?? [])];
  }

  async append(sessionId: string, message: Message): Promise<void> {
    const messages = this.#sessions.get(sessionId) ?? [];
    messages.push(message);
    this.#sessions.set(sessionId, messages);
  }

  async clear(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId);
  }
}

export function inMemory(): XsafMemoryDriver {
  return new InMemoryMemory();
}
