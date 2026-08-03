/// <reference types="bun" />

import { afterEach, describe, expect, test } from "bun:test";
import httpAgent from "../src/http";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const chunk of stream) text += chunk;
  return text;
}

describe("standalone HTTP agent", () => {
  test("streams text and forwards remote lifecycle events", async () => {
    let request: Request | undefined;
    globalThis.fetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      request = new Request(input, init);
      const body = [
        'event: delegate.started\ndata: {"type":"delegate.started","delegate":"weather_advisor","sessionId":"tui"}\n\n',
        'event: tool.called\ndata: {"type":"tool.called","tool":"get_weather","sessionId":"tui:delegate:weather_advisor"}\n\n',
        'event: message.delta\ndata: {"text":"Wear a "}\n\n',
        'event: message.delta\ndata: {"text":"jacket."}\n\n',
        'event: tool.completed\ndata: {"type":"tool.completed","tool":"get_weather","sessionId":"tui:delegate:weather_advisor"}\n\n',
        'event: delegate.completed\ndata: {"type":"delegate.completed","delegate":"weather_advisor","sessionId":"tui"}\n\n',
        'event: message.completed\ndata: {"sessionId":"tui"}\n\n',
      ].join("");
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;

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
    expect("textStream" in result).toBe(true);
    if (!("textStream" in result)) throw new Error("Expected a streaming response");
    expect(await collect(result.textStream)).toBe("Wear a jacket.");
    expect((await result.completed).text).toBe("Wear a jacket.");
    expect(events).toEqual(["weather_advisor", "get_weather"]);
    expect(request?.url).toBe("http://localhost:3000/chat");
    expect(request?.headers.get("authorization")).toBe("Bearer secret");
    expect(await request?.json()).toEqual({ text: "What should I wear?", sessionId: "tui" });
  });

  test("reports HTTP authentication failures before opening the TUI stream", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const agent = httpAgent({ url: "http://localhost:3000" });
    await expect(agent.invoke("hello")).rejects.toThrow("Unauthorized");
  });
});
