import type { Message, XsafMemoryDriver } from "../types";
export declare class InMemoryMemory implements XsafMemoryDriver {
  #private;
  get(sessionId: string): Promise<Message[]>;
  append(sessionId: string, message: Message): Promise<void>;
  clear(sessionId: string): Promise<void>;
}
export declare function inMemory(): XsafMemoryDriver;
