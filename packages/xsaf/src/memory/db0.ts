import type { Database } from "db0";
import type { Message, XsafMemoryDriver } from "../types";

const ROLES = new Set<Message["role"]>(["system", "user", "assistant", "tool"]);

const DDL = `
CREATE TABLE IF NOT EXISTS xsaf_messages (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  name TEXT,
  tool_call_id TEXT,
  meta TEXT,
  PRIMARY KEY (session_id, seq)
);
CREATE INDEX IF NOT EXISTS xsaf_messages_content_idx ON xsaf_messages (content);
`;

export interface Db0MemoryOptions {
  /**
   * When true (default), `close()` calls `database.dispose()`.
   * Set false if Nitro/`useDatabase()` (or another owner) still needs the handle.
   */
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
  /**
   * Substring search over persisted message content (SQL `LIKE`).
   * Searches all sessions unless `sessionId` is set.
   */
  search(options: MemorySearchOptions): Promise<MemorySearchHit[]>;
}

type Row = {
  readonly session_id: unknown;
  readonly seq: unknown;
  readonly role: unknown;
  readonly content: unknown;
  readonly name: unknown;
  readonly tool_call_id: unknown;
  readonly meta: unknown;
};

function parseMeta(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new TypeError("db0 memory meta must be a JSON string");
  }
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("db0 memory meta must be a JSON object");
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function rowToMessage(row: Row, index: number): Message {
  if (typeof row.role !== "string" || !ROLES.has(row.role as Message["role"])) {
    throw new TypeError(`db0 memory row ${index} has an invalid role`);
  }
  if (typeof row.content !== "string") {
    throw new TypeError(`db0 memory row ${index} has invalid content`);
  }
  const meta = parseMeta(row.meta);
  return {
    role: row.role as Message["role"],
    content: row.content,
    ...(typeof row.name === "string" ? { name: row.name } : {}),
    ...(typeof row.tool_call_id === "string" ? { toolCallId: row.tool_call_id } : {}),
    ...(meta !== undefined ? { meta } : {}),
  };
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

class Db0Memory implements XsafDb0MemoryDriver {
  readonly #db: Database;
  readonly #disposeOnClose: boolean;
  #ready: Promise<void> | undefined;

  constructor(database: Database, options?: Db0MemoryOptions) {
    this.#db = database;
    this.#disposeOnClose = options?.dispose ?? true;
  }

  async #ensure(): Promise<void> {
    this.#ready ??= this.#db.exec(DDL).then(() => undefined);
    await this.#ready;
  }

  async get(sessionId: string): Promise<Message[]> {
    await this.#ensure();
    const rows = (await this.#db
      .prepare(
        "SELECT session_id, seq, role, content, name, tool_call_id, meta FROM xsaf_messages WHERE session_id = ? ORDER BY seq ASC",
      )
      .all(sessionId)) as Row[];
    return rows.map((row, index) => rowToMessage(row, index));
  }

  async append(sessionId: string, message: Message): Promise<void> {
    await this.#ensure();
    const last = (await this.#db
      .prepare("SELECT MAX(seq) AS max_seq FROM xsaf_messages WHERE session_id = ?")
      .get(sessionId)) as { readonly max_seq?: unknown } | undefined;
    const next =
      last && typeof last.max_seq === "number"
        ? last.max_seq + 1
        : last && typeof last.max_seq === "bigint"
          ? Number(last.max_seq) + 1
          : last && typeof last.max_seq === "string" && last.max_seq !== ""
            ? Number(last.max_seq) + 1
            : 0;
    if (!Number.isFinite(next)) throw new TypeError("db0 memory could not compute next seq");

    await this.#db
      .prepare(
        "INSERT INTO xsaf_messages (session_id, seq, role, content, name, tool_call_id, meta) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        sessionId,
        next,
        message.role,
        message.content,
        message.name ?? null,
        message.toolCallId ?? null,
        message.meta === undefined ? null : JSON.stringify(message.meta),
      );
  }

  async clear(sessionId: string): Promise<void> {
    await this.#ensure();
    await this.#db.prepare("DELETE FROM xsaf_messages WHERE session_id = ?").run(sessionId);
  }

  async search(options: MemorySearchOptions): Promise<MemorySearchHit[]> {
    await this.#ensure();
    const query = options.query.trim();
    if (!query) return [];
    const limit = Math.min(Math.max(1, options.limit ?? 20), 100);
    const pattern = `%${escapeLike(query)}%`;

    const rows = (
      options.sessionId === undefined
        ? await this.#db
            .prepare(
              "SELECT session_id, seq, role, content, name, tool_call_id, meta FROM xsaf_messages WHERE content LIKE ? ESCAPE '\\' ORDER BY session_id ASC, seq ASC LIMIT ?",
            )
            .all(pattern, limit)
        : await this.#db
            .prepare(
              "SELECT session_id, seq, role, content, name, tool_call_id, meta FROM xsaf_messages WHERE session_id = ? AND content LIKE ? ESCAPE '\\' ORDER BY seq ASC LIMIT ?",
            )
            .all(options.sessionId, pattern, limit)
    ) as Row[];

    return rows.map((row, index) => {
      if (typeof row.session_id !== "string") {
        throw new TypeError(`db0 memory search row ${index} has an invalid session_id`);
      }
      const seq =
        typeof row.seq === "number"
          ? row.seq
          : typeof row.seq === "bigint"
            ? Number(row.seq)
            : typeof row.seq === "string"
              ? Number(row.seq)
              : Number.NaN;
      if (!Number.isFinite(seq)) {
        throw new TypeError(`db0 memory search row ${index} has an invalid seq`);
      }
      return {
        sessionId: row.session_id,
        seq,
        message: rowToMessage(row, index),
      };
    });
  }

  async close(): Promise<void> {
    if (this.#disposeOnClose) await this.#db.dispose();
  }
}

/** Wrap a [db0](https://db0.unjs.io/) `Database` as an `XsafMemoryDriver` with SQL search. */
export function db0(database: Database, options?: Db0MemoryOptions): XsafDb0MemoryDriver {
  return new Db0Memory(database, options);
}
