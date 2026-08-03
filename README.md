# XSAF

**Extra Small Agent Framework for TypeScript.** Build useful AI agents with a fluent API, explicit security boundaries, a fetch-native Hono runtime, and MCP v2 built in.

[Documentation](https://xsaf.ilha.build) · [Getting started](https://xsaf.ilha.build/getting-started) · [Roadmap](https://xsaf.ilha.build/roadmap) · [GitHub](https://github.com/ilhajs/xsaf)

```ts
const agent = xsaf
  .agent(config)
  .sandbox(sandbox)
  .tool(search)
  .memory(memory)
  .serve({ transport: "http" });

await agent.start();
```

XSAF coordinates models, tools, memory, channels, delegated agents, schedules, and MCP without turning your application into a workflow platform. Configuration stays visible, lifecycle stays deterministic, and deployment remains yours.

## Why XSAF?

- **Small, fluent core** — compose only the capabilities your agent needs.
- **Fetch native** — every agent owns a Hono app and a web-standard `fetch` handler; XSAF never forces a server or opens a socket.
- **MCP v2 built in** — expose local tools or consume remote MCP tools over HTTP using the official MCP SDK backbone.
- **One tool pipeline** — validation, approval, cancellation, timeout, retries, sandbox selection, events, and errors follow one path.
- **Session aware** — serialize work within a session while independent sessions run concurrently.
- **Easy to test** — deterministic model and channel adapters exercise complete agents without network calls or AI tokens.
- **Replaceable infrastructure** — memory, channels, models, schedules, sandboxes, and MCP connections are structural drivers.

## Install

```sh
bun add xsaf
```

```sh
npm install xsaf
```

XSAF is ESM-only and declares Node.js 20 or newer. Its core HTTP surface uses web-standard `Request`, `Response`, and `fetch` APIs.

## Run an agent without tokens

This complete example is deterministic and makes no network requests:

```ts
import { xsaf } from "xsaf";
import mockChannel from "xsaf/channel/mock";
import mockModel from "xsaf/model/mock";

const model = mockModel({
  response(request) {
    const prompt = request.messages.findLast((message) => message.role === "user")?.content;

    return { text: `Agent received: ${prompt ?? ""}` };
  },
});

const channel = mockChannel();
const builder = xsaf
  .agent({
    name: "mock_assistant",
    description: "A deterministic local assistant.",
    model: "mock/model",
    baseURL: "mock://local",
    apiKey: "not-used",
    persona: "You are a concise assistant.",
    stream: false,
    modelAdapter: model,
  })
  .channel(channel)
  .serve({ transport: "http", path: "/mcp" });

await builder.start();
await channel.receive({ sessionId: "demo", text: "hello xsaf" });

console.log(channel.sent[0]?.payload);
await builder.stop();
```

Move from the mock adapter to xsAI-backed models without changing the surrounding agent architecture.

## Optional terminal chat UI

Install `@xsaf/tui` for a polished Pi-powered terminal experience with a multiline prompt, Markdown history, streaming responses, tool and delegate statuses, and customizable themes:

```sh
bun add xsaf @xsaf/tui
```

```ts
import tui from "@xsaf/tui";

const chat = tui({
  agent: builder,
  onExit: () => builder.stop(),
});

chat.start();
```

## A runtime that fits your application

Every started agent exposes a shared Hono application:

```ts
const agent = await builder.start();

export default {
  fetch(request: Request) {
    return agent.fetch(request);
  },
};
```

Built-in routes include:

| Route          | Purpose                              |
| -------------- | ------------------------------------ |
| `GET /health`  | Basic readiness response             |
| `POST /invoke` | Invoke the normal agent request path |
| `/mcp`         | MCP endpoint mounted by `.serve()`   |
| `/chat`        | Optional bundled HTTP channel        |

Use the same handler with a compatible Node adapter, Bun, Deno, Workers, or another fetch-native host supported by XSAF's dependencies.

## Explicit security boundaries

XSAF does not silently execute model-selected tools on the host. Executable local tools, delegates, and MCP tools require an explicit sandbox driver.

```ts
import local from "xsaf/sandbox/local";

builder.sandbox(local()); // Explicit opt-in: no isolation.
```

The bundled local adapter is intended for development and trusted code. Production isolation should use an AgentOS-compatible `XsafSandboxDriver` or another sandbox implementation. Untrusted MCP tools require human approval by default, and public approval events never expose tool arguments.

Read [Tools & Security](https://xsaf.ilha.build/tools) before enabling executable tools.

## What is included

- xsAI model adapter with generation, streaming, and structured output
- Standard Schema validation and Standard JSON Schema publication for tools
- In-memory session memory with replaceable durable drivers
- Mock and HTTP channels
- Delegated child agents with context isolation by default
- Process-local cron scheduling with overlap protection
- MCP `2026-07-28` HTTP client and server support
- Typed lifecycle and telemetry events
- Deterministic reverse-order cleanup

## Alpha status

XSAF is currently `0.1.0-alpha.0`. The core is tested and usable, but APIs may change before a stable release. The alpha intentionally does not include a production sandbox implementation, durable scheduling, SQLite memory, platform-specific chat channels, authentication, rate limiting, or a socket listener.

See the [Roadmap](https://xsaf.ilha.build/roadmap) for current boundaries and planned work.

## Repository

```text
packages/xsaf/   Framework core, adapters, and tests
packages/tui/    Optional Pi-powered terminal chat UI
apps/website/    Nimbus documentation site
SPEC.md          Alpha behavior and scope
```

```sh
bun install
bun run typecheck
bun run lint
bun test
bun run build
```

Tests use mocked models and make no real AI requests.

## License

MIT
