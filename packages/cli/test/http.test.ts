/// <reference types="bun" />

import { afterEach, describe, expect, test } from "bun:test";
import { ORPCError, os, type AnyRouter } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import httpAgent from "../src/http";
import type { ChatEvent } from "../src/protocol";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const chunk of stream) text += chunk;
  return text;
}

function serve(procedure: AnyRouter, onRequest?: (request: Request) => void): void {
  const handler = new RPCHandler(procedure);
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const request = new Request(input, init);
    onRequest?.(request);
    const result = await handler.handle(request, {
      prefix: "/chat",
      context: { authorization: request.headers.get("authorization") },
    });
    if (!result.matched) return new Response("Not Found", { status: 404 });
    return result.response;
  }) as unknown as typeof fetch;
}

describe("standalone oRPC agent", () => {
  test("streams text and forwards remote lifecycle events", async () => {
    const captured = { authorization: null as string | null };
    const procedure = os.handler(async function* (): AsyncGenerator<ChatEvent> {
      yield { type: "delegate.started", delegate: "weather_advisor", sessionId: "tui" };
      yield {
        type: "tool.called",
        tool: "get_weather",
        sessionId: "tui:delegate:weather_advisor",
      };
      yield { type: "message.delta", text: "Wear a " };
      yield { type: "message.delta", text: "jacket." };
      yield {
        type: "tool.completed",
        tool: "get_weather",
        sessionId: "tui:delegate:weather_advisor",
      };
      yield { type: "delegate.completed", delegate: "weather_advisor", sessionId: "tui" };
      yield { type: "message.completed", sessionId: "tui" };
    });
    serve(procedure, (request) => {
      captured.authorization = request.headers.get("authorization");
    });

    const events: string[] = [];
    const agent = httpAgent({
      url: "http://localhost:3000",
      apiKey: "secret",
    });
    agent.on("delegate.started", (event) => {
      events.push(event.delegate);
    });
    agent.on("tool.called", (event) => {
      events.push(event.tool);
    });

    const result = await agent.invoke("What should I wear?", "tui");
    if (!("textStream" in result)) throw new Error("Expected a streaming response");
    expect(await collect(result.textStream)).toBe("Wear a jacket.");
    expect((await result.completed).text).toBe("Wear a jacket.");
    expect(events).toEqual(["weather_advisor", "get_weather"]);
    expect(captured.authorization).toBe("Bearer secret");
  });

  test("surfaces oRPC authentication failures", async () => {
    const procedure = os
      .$context<{ readonly authorization: string | null }>()
      .use(({ context, next }) => {
        if (context.authorization !== "Bearer secret") throw new ORPCError("UNAUTHORIZED");
        return next();
      })
      .handler(async function* () {
        yield { type: "message.delta", text: "hello" } satisfies ChatEvent;
      });
    serve(procedure);

    const agent = httpAgent({ url: "http://localhost:3000" });
    const result = await agent.invoke("hello");
    if (!("textStream" in result)) throw new Error("Expected a streaming response");
    await expect(collect(result.textStream)).rejects.toThrow("Unauthorized");
  });
});
