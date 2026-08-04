import type { Database } from "db0";
import type { Message, XsafMemoryDriver } from "../types";

export interface Db0MemoryOptions {
  readonly dispose?: boolean;
}

export interface MemorySearchOptions {
  /** Case-insensitive substring match against message content. */
  readonly query: string;
  /** When set, limit results to this session; omit to search all sessions. */
  readonly sessionId?: string;
  /** Max rows to return (default 20, capped at 100). */
  readonly limit?: number;
}

export interface MemorySearchHit {
  readonly sessionId: string;
  readonly seq: number;
  readonly message: Message;
}

export interface XsafDb0MemoryDriver extends XsafMemoryDriver {
  search(options: MemorySearchOptions): Promise<MemorySearchHit[]>;
}

export declare function db0(database: Database, options?: Db0MemoryOptions): XsafDb0MemoryDriver;
