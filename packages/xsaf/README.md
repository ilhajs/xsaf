# XSAF

Extra Small Agent Framework: a fluent TypeScript agent runtime built on xsAI, Hono, and the MCP TypeScript SDK.

## Backbone

Every agent owns a Hono application created through `@modelcontextprotocol/hono`:

- `POST /invoke` runs the normal XSAF request path.
- `GET /health` provides a basic readiness response.
- `.serve({ transport: "http" })` mounts the agent's tools on `/mcp` using the MCP v2 per-request handler.
- `agent.app` supports Hono composition and in-memory `app.request()` testing.
- `agent.fetch(request)` can be passed to a runtime HTTP server.

The Hono MCP middleware keeps its localhost DNS-rebinding and Origin protections enabled by default.

## Mock agent quick start

The included example is entirely local. Its model, channel, and HTTP requests are deterministic mocks, so it consumes no AI tokens and opens no listening socket.

```bash
bun run example:mock
```

```ts
import { xsaf } from "xsaf";
import mockChannel from "xsaf/channel/mock";
import mockModel from "xsaf/model/mock";

const ai = mockModel({ response: "Hello from the mock model" });
const channel = mockChannel();
const agent = xsaf
  .agent({
    model: "mock/model",
    baseURL: "mock://local",
    apiKey: "not-used",
    persona: "You are a test agent.",
    stream: false,
    modelAdapter: ai,
  })
  .channel(channel)
  .serve({ transport: "http", path: "/mcp" });

await agent.start();
await channel.receive({ sessionId: "demo", text: "hello" });

const response = await agent.app.request("http://localhost/invoke", {
  method: "POST",
  headers: { host: "localhost", "content-type": "application/json" },
  body: JSON.stringify({ sessionId: "http-demo", prompt: "hello hono" }),
});
console.log(await response.json());
await agent.stop();
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

Executable tools always require an explicit sandbox. Use an AgentOS-compatible driver for isolation or deliberately opt out with `xsaf/sandbox/local`.
