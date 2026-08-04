import { describe, expect, test } from "bun:test";
import { createORPCClient, type Client } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { XsafToolSchema } from "../src";
import { ToolApprovalError, ToolTimeoutError, xsaf } from "../src";
import type {
  AgentResult,
  ModelRequest,
  ModelResponse,
  ScheduledTask,
  ScheduleConfig,
  XsafModel,
  XsafModelAdapter,
  XsafSchedulerDriver,
} from "../src/types";
import http from "../src/channel/http";
import mock from "../src/channel/mock";
import mockModel from "../src/model/mock";
import mcp from "../src/mcp";
import local from "../src/sandbox/local";
import { inMemory } from "../src/memory/in-memory";

const config = (
  value: XsafModel | XsafModelAdapter,
  overrides: Partial<Parameters<typeof xsaf.agent>[0]> = {},
) => ({
  model: "adapter" in value ? value : { name: "mock-model", adapter: value },
  persona: "test persona",
  stream: false,
  ...overrides,
});

class MockAdapter implements XsafModelAdapter {
  readonly requests: ModelRequest[] = [];
  constructor(
    readonly respond: (request: ModelRequest) => Promise<ModelResponse> | ModelResponse = () => ({
      text: "mock",
    }),
  ) {}
  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return this.respond(request);
  }
}

function objectSchema(): XsafToolSchema<unknown, { readonly value: number }> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      jsonSchema: {
        input: () => ({
          type: "object",
          properties: { value: { type: "number" } },
          required: ["value"],
          additionalProperties: false,
        }),
        output: () => ({ type: "object" }),
      },
      validate(input) {
        if (
          typeof input === "object" &&
          input !== null &&
          "value" in input &&
          typeof input.value === "number"
        ) {
          return { value: { value: input.value } };
        }
        return { issues: [{ message: "value must be a number" }] };
      },
    },
  };
}

type ChatEvent =
  | { readonly type: "message.delta"; readonly text: string }
  | { readonly type: "message.completed"; readonly sessionId: string }
  | { readonly type: string; readonly [key: string]: unknown };

type ChatClient = Client<
  Record<never, never>,
  { readonly text: string; readonly sessionId?: string },
  AsyncIterator<ChatEvent, void, unknown>,
  unknown
>;

function createChatClient(fetch: typeof globalThis.fetch, apiKey?: string): ChatClient {
  const link = new RPCLink({
    url: "http://localhost/chat",
    fetch,
    ...(apiKey ? { headers: { authorization: `Bearer ${apiKey}` } } : {}),
  });
  return createORPCClient<ChatClient>(link);
}

async function collectChat(
  iterator: AsyncIterator<ChatEvent, void, unknown>,
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  while (true) {
    const result = await iterator.next();
    if (result.done) return events;
    events.push(result.value);
  }
}

async function read(
  result: Awaited<ReturnType<ReturnType<typeof xsaf.agent>["invoke"]>>,
): Promise<AgentResult> {
  if ("textStream" in result) {
    for await (const _chunk of result.textStream) {
    }
    return result.completed;
  }
  return result;
}

describe("builder and lifecycle", () => {
  test("validates required config eagerly", () => {
    const adapter = new MockAdapter();
    expect(() => xsaf.agent(config(adapter, { persona: "" }))).toThrow("persona");
    expect(() => xsaf.agent(config(adapter, { model: { name: "", adapter } }))).toThrow("model");
    expect(() => xsaf.agent(config(adapter, { maxSteps: 0 }))).toThrow("maxSteps");
  });

  test("does no driver work before start and closes in reverse order", async () => {
    const calls: string[] = [];
    const adapter = new MockAdapter();
    const builder = xsaf
      .agent(config(adapter))
      .channel({
        name: "first",
        listen() {
          calls.push("start:first");
        },
        async send() {},
        async close() {
          calls.push("stop:first");
        },
      })
      .channel({
        name: "second",
        listen() {
          calls.push("start:second");
        },
        async send() {},
        async close() {
          calls.push("stop:second");
        },
      });

    expect(calls).toEqual([]);
    await builder.start();
    expect(calls).toEqual(["start:first", "start:second"]);
    await builder.stop();
    await builder.stop();
    expect(calls).toEqual(["start:first", "start:second", "stop:second", "stop:first"]);
  });

  test("cleans up resources when startup fails", async () => {
    const calls: string[] = [];
    const builder = xsaf
      .agent(config(new MockAdapter()))
      .channel({
        name: "ok",
        listen() {
          calls.push("start");
        },
        async send() {},
        async close() {
          calls.push("close:ok");
        },
      })
      .channel({
        name: "bad",
        listen() {
          throw new Error("boom");
        },
        async send() {},
        async close() {
          calls.push("close:bad");
        },
      });
    await expect(builder.start()).rejects.toThrow("boom");
    expect(calls).toEqual(["start", "close:bad", "close:ok"]);
  });

  test("requires an explicit sandbox for executable tools", async () => {
    const builder = xsaf.agent(config(mockModel())).tool({
      name: "unsafe_tool",
      description: "must be isolated",
      input: objectSchema(),
      async execute() {},
    });
    await expect(builder.start()).rejects.toThrow("explicit sandbox");
  });

  test("propagates configured agent identity", async () => {
    const builder = xsaf.agent(
      config(mockModel(), {
        name: "main_agent",
        description: "Primary test agent",
      }),
    );
    expect(builder.name).toBe("main_agent");
    expect(builder.description).toBe("Primary test agent");
    const agent = builder;
    expect(agent.name).toBe("main_agent");
    expect(agent.description).toBe("Primary test agent");
    expect(() => xsaf.agent(config(mockModel(), { name: "Not Valid" }))).toThrow(
      "snake_case agent name",
    );
  });

  test("coalesces concurrent lifecycle calls", async () => {
    let listens = 0;
    let closes = 0;
    const agent = xsaf.agent(config(mockModel())).channel({
      name: "concurrent",
      async listen() {
        await Promise.resolve();
        listens += 1;
      },
      async send() {},
      async close() {
        await Promise.resolve();
        closes += 1;
      },
    });
    await Promise.all([agent.start(), agent.start()]);
    await Promise.all([agent.stop(), agent.stop()]);
    expect({ listens, closes }).toEqual({ listens: 1, closes: 1 });
  });

  test("aggregates shutdown failures after reverse-order cleanup", async () => {
    const closed: string[] = [];
    const agent = xsaf
      .agent(config(mockModel()))
      .channel({
        name: "close_first",
        listen() {},
        async send() {},
        async close() {
          closed.push("first");
          throw new Error("first failed");
        },
      })
      .channel({
        name: "close_second",
        listen() {},
        async send() {},
        async close() {
          closed.push("second");
          throw new Error("second failed");
        },
      });
    await agent.start();
    await expect(agent.stop()).rejects.toBeInstanceOf(AggregateError);
    expect(closed).toEqual(["second", "first"]);
  });

  test("rejects duplicate names and changes after sealing", () => {
    const builder = xsaf.agent(config(new MockAdapter())).tool({
      name: "valid_tool",
      description: "valid",
      input: objectSchema(),
      async execute() {},
    });
    expect(() =>
      builder.tool({
        name: "valid_tool",
        description: "again",
        input: objectSchema(),
        async execute() {},
      }),
    ).toThrow("Duplicate");
    const conflictingDelegate = xsaf.agent(config(new MockAdapter(), { name: "valid_tool" }));
    expect(() => builder.delegate(conflictingDelegate)).toThrow("Duplicate");
    const child = xsaf.agent(config(new MockAdapter(), { name: "child" }));
    builder.delegate(child);
    expect(child.name).toBe("child");
    expect(() => child.memory(inMemory())).toThrow("sealed");
  });
});

describe("runtime, memory, and channels", () => {
  test("persists sessions independently and uses a mocked model only", async () => {
    const adapter = new MockAdapter((request) => ({
      text: `reply:${request.messages.at(-1)?.content}`,
    }));
    const memory = inMemory();
    const builder = xsaf.agent(config(adapter)).memory(memory);
    await builder.start();
    expect((await read(await builder.invoke("one", "a"))).text).toBe("reply:one");
    await read(await builder.invoke("two", "b"));
    expect((await memory.get("a")).map((message) => message.content)).toEqual(["one", "reply:one"]);
    expect((await memory.get("b")).map((message) => message.content)).toEqual(["two", "reply:two"]);
    expect(adapter.requests).toHaveLength(2);
    await builder.stop();
  });

  test("runs end-to-end with the public mock model and mock channel", async () => {
    const channel = mock();
    const adapter = mockModel({ response: "from-agent" });
    const builder = xsaf.agent(config(adapter)).channel(channel);
    await builder.start();
    await channel.receive({ sessionId: "chat-1", text: "hello" });
    expect(channel.sent).toEqual([{ target: "chat-1", payload: "from-agent" }]);
    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0]?.messages.at(-1)?.content).toBe("hello");
    await builder.stop();
  });

  test("serves authenticated SSE iterator through the HTTP channel", async () => {
    const channel = http({ path: "/chat", apiKey: "test-key" });
    const builder = xsaf.agent(config(mockModel({ response: "http-channel" }))).channel(channel);
    await builder.start();

    const fetchImpl = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const req = new Request(input, init);
      const headers = new Headers(req.headers);
      headers.set("host", "localhost");
      return builder.app.request(req.url, {
        method: req.method,
        headers,
        body: req.body,
      });
    }) as unknown as typeof fetch;

    const client = createChatClient(fetchImpl);
    await expect(client({ sessionId: "http-chat", text: "hello" })).rejects.toThrow("Unauthorized");

    const authClient = createChatClient(fetchImpl, "test-key");
    const iterator = await authClient({ sessionId: "http-chat", text: "hello" });
    const events = await collectChat(iterator);

    expect(events).toEqual([
      { type: "message.delta", text: "http-channel" },
      { type: "message.completed", sessionId: "http-chat" },
    ]);

    await builder.stop();
  });

  test("streams tool lifecycle events through the HTTP channel", async () => {
    const adapter = new MockAdapter(async (request) => {
      const tool = request.tools.find((candidate) => candidate.name === "weather_lookup");
      if (!tool) throw new Error("weather_lookup tool missing");
      await tool.execute({ value: 1 });
      return { text: "sunny" };
    });
    const builder = xsaf
      .agent(config(adapter))
      .sandbox(local({ unsafe: true }))
      .tool({
        name: "weather_lookup",
        description: "looks up weather",
        input: objectSchema(),
        async execute() {
          return { conditions: "sunny" };
        },
      })
      .channel(http({ path: "/chat" }));
    await builder.start();

    const fetchImpl = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const req = new Request(input, init);
      const headers = new Headers(req.headers);
      headers.set("host", "localhost");
      return builder.app.request(req.url, {
        method: req.method,
        headers,
        body: req.body,
      });
    }) as unknown as typeof fetch;

    const client = createChatClient(fetchImpl);
    const iterator = await client({ sessionId: "weather", text: "weather" });
    const events = await collectChat(iterator);

    expect(events).toContainEqual({
      type: "tool.called",
      tool: "weather_lookup",
      sessionId: "weather",
    });
    expect(events).toContainEqual({
      type: "tool.completed",
      tool: "weather_lookup",
      sessionId: "weather",
    });
    expect(events).toContainEqual({ type: "message.delta", text: "sunny" });
    expect(events).toContainEqual({ type: "message.completed", sessionId: "weather" });

    await builder.stop();
  });

  test("uses Hono as the HTTP invocation backbone", async () => {
    const adapter = mockModel({ response: "hono-response" });
    const builder = xsaf.agent(config(adapter));
    await builder.start();
    const response = await builder.app.request("http://localhost/invoke", {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "hono-session", prompt: "hello hono" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "hono-response" });
    expect(adapter.requests[0]?.messages.at(-1)?.content).toBe("hello hono");
    const malformed = await builder.app.request("http://localhost/invoke", {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    const blank = await builder.app.request("http://localhost/invoke", {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ prompt: "   " }),
    });
    expect(blank.status).toBe(400);
    await builder.stop();
  });

  test("serializes concurrent requests within one session", async () => {
    let active = 0;
    let maximum = 0;
    const adapter = new MockAdapter(async (request) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { text: `reply-${request.messages.at(-1)?.content}` };
    });
    const builder = xsaf.agent(config(adapter));
    await builder.start();
    await Promise.all([
      builder.invoke("first", "serialized"),
      builder.invoke("second", "serialized"),
    ]);
    expect(maximum).toBe(1);
    expect(adapter.requests[1]?.messages.map((message) => message.content)).toContain(
      "reply-first",
    );
    await builder.stop();
  });

  test("preserves streaming backpressure and persists after consumption", async () => {
    const memory = inMemory();
    let pulls = 0;
    const adapter: XsafModelAdapter = {
      async generate() {
        return { text: "unused" };
      },
      stream() {
        return {
          textStream: (async function* () {
            pulls += 1;
            yield "a";
            pulls += 1;
            yield "b";
          })(),
        };
      },
    };
    const builder = xsaf.agent(config(adapter, { stream: true })).memory(memory);
    await builder.start();
    const result = await builder.invoke("go", "stream");
    expect("textStream" in result).toBe(true);
    expect(pulls).toBe(0);
    const completed = await read(result);
    expect(completed.text).toBe("ab");
    expect(pulls).toBe(2);
    expect((await memory.get("stream")).at(-1)?.content).toBe("ab");
    await builder.stop();
  });
});

describe("tool pipeline", () => {
  test("validates, approves, sandboxes, and retries centrally", async () => {
    let attempts = 0;
    let sandboxRuns = 0;
    const adapter = new MockAdapter(async (request) => {
      const value = await request.tools[0]?.execute({ value: 2 });
      return { text: JSON.stringify(value) };
    });
    const approvals: string[] = [];
    const completed: string[] = [];
    const builder = xsaf
      .agent(config(adapter))
      .sandbox({
        ...local({ unsafe: true }),
        name: "tracking_host",
        async run(fn, args) {
          sandboxRuns += 1;
          return fn(...args);
        },
      })
      .tool({
        name: "double_value",
        description: "doubles a value",
        input: objectSchema(),
        approval: "human",
        retries: 1,
        async execute(input) {
          attempts += 1;
          if (attempts === 1) throw new Error("transient");
          return input.value * 2;
        },
      })
      .on("approval.required", (event) => {
        approvals.push(event.tool);
      })
      .on("tool.completed", (event) => {
        completed.push(event.tool);
      })
      .approve(() => true);
    await builder.start();
    expect((await read(await builder.invoke("run"))).text).toBe("4");
    expect(attempts).toBe(2);
    expect(sandboxRuns).toBe(2);
    expect(approvals).toEqual(["double_value"]);
    expect(completed).toEqual(["double_value"]);
    await builder.stop();
  });

  test("does not retry invalid input or denied approval", async () => {
    let executions = 0;
    let toolError: unknown;
    const adapter = new MockAdapter(async (request) => {
      try {
        await request.tools[0]?.execute({ value: 1 });
      } catch (error) {
        toolError = error;
      }
      return { text: "handled" };
    });
    const builder = xsaf
      .agent(config(adapter))
      .sandbox(local({ unsafe: true }))
      .tool({
        name: "denied_tool",
        description: "denied",
        input: objectSchema(),
        approval: "human",
        retries: 3,
        async execute() {
          executions += 1;
        },
      });
    await builder.start();
    await builder.invoke("run");
    expect(toolError).toBeInstanceOf(ToolApprovalError);
    expect(executions).toBe(0);
    await builder.stop();
  });

  test("does not overlap retries after a timeout", async () => {
    let attempts = 0;
    const adapter = new MockAdapter(async (request) => ({
      text: String(await request.tools[0]?.execute({ value: 1 })),
    }));
    const builder = xsaf
      .agent(config(adapter))
      .sandbox(local({ unsafe: true }))
      .tool({
        name: "slow_tool",
        description: "slow",
        input: objectSchema(),
        timeout: 5,
        retries: 2,
        async execute() {
          attempts += 1;
          await new Promise((resolve) => setTimeout(resolve, 30));
        },
        onError(error) {
          return error instanceof ToolTimeoutError ? "timed-out" : "wrong";
        },
      });
    await builder.start();
    expect((await read(await builder.invoke("run"))).text).toBe("timed-out");
    expect(attempts).toBe(1);
    await builder.stop();
  });

  test("combines caller cancellation with the timeout signal", async () => {
    let aborted = false;
    const adapter = new MockAdapter(async (request) => {
      const controller = new AbortController();
      controller.abort();
      await request.tools[0]?.execute({ value: 1 }, { signal: controller.signal });
      return { text: "cancelled" };
    });
    const builder = xsaf
      .agent(config(adapter))
      .sandbox(local({ unsafe: true }))
      .tool({
        name: "cancelled_tool",
        description: "observes cancellation",
        input: objectSchema(),
        timeout: 100,
        async execute(_input, context) {
          aborted = context.signal?.aborted ?? false;
        },
      });
    await builder.start();
    await builder.invoke("run");
    expect(aborted).toBe(true);
    await builder.stop();
  });
});

describe("delegation, MCP, schedules, and structured output", () => {
  test("delegate receives no parent history and forwards its tool events", async () => {
    const delegateEvents: string[] = [];
    const toolEvents: string[] = [];
    const childAdapter = new MockAdapter(async (request) => {
      expect(request.messages.some((message) => message.content === "parent secret")).toBe(false);
      const tool = request.tools.find((candidate) => candidate.name === "child_lookup");
      if (!tool) throw new Error("child_lookup tool missing");
      return { text: String(await tool.execute({ value: 1 })) };
    });
    const child = xsaf
      .agent(config(childAdapter, { name: "researcher", description: "research tasks" }))
      .sandbox(local({ unsafe: true }))
      .tool({
        name: "child_lookup",
        description: "looks up a value",
        input: objectSchema(),
        async execute() {
          return "child-result";
        },
      });
    const parentAdapter = new MockAdapter(async (request) => {
      const delegate = request.tools.find((tool) => tool.name === "researcher");
      if (!delegate) throw new Error("researcher tool missing");
      const result = (await delegate.execute({ prompt: "task" })) as AgentResult;
      return { text: String(result.text) };
    });
    const parent = xsaf
      .agent(config(parentAdapter))
      .sandbox(local({ unsafe: true }))
      .delegate(child)
      .on("delegate.started", (event) => delegateEvents.push(event.type))
      .on("delegate.completed", (event) => delegateEvents.push(event.type))
      .on("tool.completed", (event) => toolEvents.push(event.tool));
    await parent.start();
    expect((await read(await parent.invoke("parent secret"))).text).toBe("child-result");
    expect(delegateEvents).toEqual(["delegate.started", "delegate.completed"]);
    expect(toolEvents).toEqual(["child_lookup"]);
    await parent.stop();
  });

  test("serves tools through the Hono MCP backbone", async () => {
    const builder = xsaf
      .agent(config(mockModel()))
      .sandbox(local({ unsafe: true }))
      .tool({
        name: "echo_value",
        description: "echoes a numeric value",
        input: objectSchema(),
        async execute(input) {
          return input;
        },
      })
      .serve({ path: "/mcp" });
    await builder.start();
    const response = await builder.app.request("http://localhost/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        host: "localhost",
        "content-type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "xsaf-test",
              version: "1.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      result?: {
        tools?: Array<{
          name: string;
          inputSchema?: { required?: string[] };
        }>;
      };
    };
    expect(payload.result?.tools?.map((tool) => tool.name)).toContain("echo_value");
    expect(payload.result?.tools?.[0]?.inputSchema?.required).toEqual(["value"]);
    const called = await builder.app.request("http://localhost/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        host: "localhost",
        "content-type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "echo_value",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "echo_value",
          arguments: { value: 4 },
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "xsaf-test",
              version: "1.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    expect(called.status).toBe(200);
    const callPayload = (await called.json()) as {
      result?: { content?: Array<{ text?: string }> };
    };
    expect(callPayload.result?.content?.[0]?.text).toBe('{"value":4}');
    await builder.stop();
  });

  test("consumes MCP v2 tools over HTTP without a client adapter", async () => {
    const methods: string[] = [];
    const driver = mcp({
      name: "remote",
      transport: "http",
      url: "https://mcp.test/",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const body = (await request.json()) as { method: string };
        methods.push(body.method);
        const result =
          body.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "remote_echo",
                    description: "echo",
                    inputSchema: {
                      type: "object",
                      properties: { value: { type: "number" } },
                      required: ["value"],
                    },
                  },
                ],
              }
            : { content: [{ type: "text", text: "remote-result" }] };
        return Response.json({ jsonrpc: "2.0", id: 1, result });
      },
    });
    const connection = await driver.connect({ async emit() {} });
    const result = await connection?.tools?.[0]?.execute({ value: 2 }, { sessionId: "mcp" });
    expect(result).toEqual({ content: [{ type: "text", text: "remote-result" }] });
    expect(methods).toEqual(["tools/list", "tools/call"]);
  });

  test("rejects MCP tool names that collide with local tools", async () => {
    let closed = false;
    const builder = xsaf
      .agent(config(mockModel()))
      .sandbox(local({ unsafe: true }))
      .tool({
        name: "shared_tool",
        description: "local",
        input: objectSchema(),
        async execute() {},
      })
      .mcp({
        name: "collision-server",
        async connect() {
          return {
            tools: [
              {
                name: "shared_tool",
                description: "remote",
                input: objectSchema(),
                async execute() {},
              },
            ],
          };
        },
        async close() {
          closed = true;
        },
      });
    await expect(builder.start()).rejects.toThrow("Duplicate model-visible");
    expect(closed).toBe(true);
  });

  test("untrusted MCP tools require approval by default", async () => {
    let approvalCount = 0;
    const adapter = new MockAdapter(async (request) => ({
      text: String(await request.tools[0]?.execute({ value: 1 })),
    }));
    const builder = xsaf
      .agent(config(adapter))
      .sandbox(local({ unsafe: true }))
      .mcp({
        name: "external",
        async connect() {
          return {
            tools: [
              {
                name: "external_tool",
                description: "external",
                input: objectSchema(),
                async execute() {
                  return "ok";
                },
              },
            ],
          };
        },
      })
      .on("approval.required", () => {
        approvalCount += 1;
      })
      .approve(() => true);
    await builder.start();
    expect((await read(await builder.invoke("call"))).text).toBe("ok");
    expect(approvalCount).toBe(1);
    await builder.stop();
  });

  test("runs schedules through an injected deterministic scheduler", async () => {
    const results: string[] = [];
    const scheduler: XsafSchedulerDriver = {
      async schedule(_config: ScheduleConfig, run: () => Promise<void>): Promise<ScheduledTask> {
        await run();
        return { async close() {} };
      },
    };
    const builder = xsaf
      .agent(config(new MockAdapter(() => ({ text: "heartbeat-result" }))))
      .scheduler(scheduler)
      .schedule({
        cron: "*/15 * * * *",
        prompt: "heartbeat",
        onResult: async (result) => {
          results.push(result.text);
        },
      });
    await builder.start();
    expect(results).toEqual(["heartbeat-result"]);
    await builder.stop();
  });

  test("uses adapter structured output without network access", async () => {
    const adapter: XsafModelAdapter = {
      async generate() {
        return { text: "unused" };
      },
      async ask(_request, schema) {
        const result = await schema["~standard"].validate({ value: 7 });
        if (result.issues) throw new Error("invalid mock");
        return result.value;
      },
    };
    const builder = xsaf.agent(config(adapter));
    await builder.start();
    expect(await builder.ask("object please", objectSchema())).toEqual({
      value: 7,
    });
    await builder.stop();
  });
});
