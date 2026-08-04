import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "db0";
import sqlite from "db0/connectors/bun-sqlite";
import { agent } from "../src";
import type { ModelRequest, ModelResponse, XsafModelAdapter } from "../src/types";
import { db0 } from "../src/memory/db0";

class MockAdapter implements XsafModelAdapter {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly respond: (request: ModelRequest) => ModelResponse) {}
  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return this.respond(request);
  }
}

const config = (adapter: XsafModelAdapter) => ({
  model: { name: "mock-model", adapter },
  persona: "test persona",
  stream: false as const,
});

describe("memory/db0", () => {
  const temps: string[] = [];

  afterEach(async () => {
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("persists sessions as ordered SQL rows", async () => {
    const database = createDatabase(sqlite({ name: ":memory:" }));
    const memory = db0(database, { dispose: false });

    await memory.append("a", { role: "user", content: "one" });
    await memory.append("a", { role: "assistant", content: "two" });
    await memory.append("b", { role: "user", content: "other" });

    expect((await memory.get("a")).map((message) => message.content)).toEqual(["one", "two"]);
    expect((await memory.get("b")).map((message) => message.content)).toEqual(["other"]);
    await memory.clear("a");
    expect(await memory.get("a")).toEqual([]);
    expect((await memory.get("b")).map((message) => message.content)).toEqual(["other"]);
    await database.dispose();
  });

  test("searches message content with optional session scope", async () => {
    const database = createDatabase(sqlite({ name: ":memory:" }));
    const memory = db0(database, { dispose: false });

    await memory.append("a", { role: "user", content: "weather in Berlin" });
    await memory.append("a", { role: "assistant", content: "sunny" });
    await memory.append("b", { role: "user", content: "weather in Paris" });

    const all = await memory.search({ query: "weather" });
    expect(all.map((hit) => hit.sessionId)).toEqual(["a", "b"]);
    expect(all.map((hit) => hit.message.content)).toEqual([
      "weather in Berlin",
      "weather in Paris",
    ]);

    const scoped = await memory.search({ query: "Berlin", sessionId: "a" });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.message.content).toBe("weather in Berlin");

    expect(await memory.search({ query: "  " })).toEqual([]);
    await database.dispose();
  });

  test("survives agent restart on a sqlite file", async () => {
    const base = await mkdtemp(join(tmpdir(), "xsaf-db0-"));
    temps.push(base);
    const path = join(base, "memory.sqlite");

    const adapter = new MockAdapter((request) => ({
      text: `reply:${request.messages.at(-1)?.content}`,
    }));

    const firstDb = createDatabase(sqlite({ path }));
    const first = agent(config(adapter)).memory(db0(firstDb));
    await first.start();
    const result = await first.invoke("hello", "vps");
    expect("text" in result ? result.text : null).toBe("reply:hello");
    await first.stop();

    const secondDb = createDatabase(sqlite({ path }));
    const secondMemory = db0(secondDb, { dispose: false });
    expect((await secondMemory.get("vps")).map((message) => message.content)).toEqual([
      "hello",
      "reply:hello",
    ]);
    const hits = await secondMemory.search({ query: "hello", sessionId: "vps" });
    expect(hits.map((hit) => hit.message.content)).toContain("hello");
    await secondDb.dispose();
  });
});
