import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import { agent } from "../src";
import type { ModelRequest, ModelResponse, XsafModelAdapter } from "../src/types";
import { unstorage } from "../src/memory/unstorage";

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

describe("memory/unstorage", () => {
  const temps: string[] = [];

  afterEach(async () => {
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("persists sessions through the default memory driver", async () => {
    const storage = createStorage();
    const memory = unstorage(storage, { dispose: false });
    await memory.append("a", { role: "user", content: "one" });
    await memory.append("a", { role: "assistant", content: "two" });
    await memory.append("b", { role: "user", content: "other" });

    expect((await memory.get("a")).map((message) => message.content)).toEqual(["one", "two"]);
    expect((await memory.get("b")).map((message) => message.content)).toEqual(["other"]);
    await memory.clear("a");
    expect(await memory.get("a")).toEqual([]);
    expect((await memory.get("b")).map((message) => message.content)).toEqual(["other"]);
  });

  test("rejects corrupt payloads", async () => {
    const storage = createStorage();
    const memory = unstorage(storage, { dispose: false });
    await storage.setItem("xsaf:session:bad", { not: "an-array" });
    await expect(memory.get("bad")).rejects.toThrow(/Message array/);
  });

  test("survives agent restart with the fs driver", async () => {
    const base = await mkdtemp(join(tmpdir(), "xsaf-memory-"));
    temps.push(base);

    const adapter = new MockAdapter((request) => ({
      text: `reply:${request.messages.at(-1)?.content}`,
    }));

    const first = agent(config(adapter)).memory(
      unstorage(createStorage({ driver: fsDriver({ base }) })),
    );
    await first.start();
    const result = await first.invoke("hello", "vps");
    if (!("text" in result)) throw new Error("expected non-streaming result");
    expect(result.text).toBe("reply:hello");
    await first.stop();

    const secondMemory = unstorage(createStorage({ driver: fsDriver({ base }) }), {
      dispose: false,
    });
    expect((await secondMemory.get("vps")).map((message) => message.content)).toEqual([
      "hello",
      "reply:hello",
    ]);
  });

  test("encodes session ids that contain reserved separators", async () => {
    const storage = createStorage();
    const memory = unstorage(storage, { dispose: false });
    const sessionId = "tenant:user/chat";
    await memory.append(sessionId, { role: "user", content: "hi" });
    expect(await storage.hasItem(`xsaf:session:${encodeURIComponent(sessionId)}`)).toBe(true);
    expect((await memory.get(sessionId))[0]?.content).toBe("hi");
  });
});
