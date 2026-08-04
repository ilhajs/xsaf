# XSAF

Extra Small Agent Framework: a fluent TypeScript agent runtime built on xsAI, Hono, and the MCP TypeScript SDK.

## Backbone

Every agent owns a Hono application created through `@modelcontextprotocol/hono`:

- `POST /invoke` runs the normal XSAF request path.
- `GET /health` provides a basic readiness response.
- `.serve()` mounts the agent's tools on `/mcp` using the MCP v2 per-request handler.
- `bot.app` supports Hono composition and in-memory `app.request()` testing.
- `bot.fetch(request)` can be passed to a runtime HTTP server.

The Hono MCP middleware keeps its localhost DNS-rebinding and Origin protections enabled by default.

## Mock agent quick start

The included example is entirely local. Its model, channel, and HTTP requests are deterministic mocks, so it consumes no AI tokens and opens no listening socket.

```bash
bun run example:mock
```

```ts
import { agent } from "@xsaf/agent";
import mockChannel from "@xsaf/agent/channel/mock";
import mockModel from "@xsaf/agent/model/mock";

const ai = mockModel({ response: "Hello from the mock model" });
const channel = mockChannel();
const bot = agent({
  model: ai,
  persona: "You are a test agent.",
  stream: false,
})
  .channel(channel)
  .serve({ path: "/mcp" });

await bot.start();
await channel.receive({ sessionId: "demo", text: "hello" });

const response = await bot.app.request("http://localhost/invoke", {
  method: "POST",
  headers: { host: "localhost", "content-type": "application/json" },
  body: JSON.stringify({ sessionId: "http-demo", prompt: "hello hono" }),
});
console.log(await response.json());
await bot.stop();
```

## Development

```bash
bun install
bun run typecheck
bun run lint
bun run fmt:check
bun test
bun run build
```

XSAF vendors the type-only Standard Schema V1 and Standard JSON Schema V1 contracts from [standardschema.dev](https://standardschema.dev/). Model-visible tool schemas must implement both validation and JSON Schema conversion.

Executable tools always require an explicit sandbox. Use an AgentOS-compatible driver for isolation or deliberately opt out with `@xsaf/agent/sandbox/local` via `local({ unsafe: true })`.
