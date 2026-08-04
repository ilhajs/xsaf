# XSAF Alpha Specification

## Scope

XSAF is a minimal ESM-first TypeScript agent framework built on xsAI, Hono, and MCP v2. Alpha targets Node.js 20+, Bun, Deno, Workers, and other fetch-native runtimes where its dependencies are supported.

## Core API

```ts
xsaf
  .agent(config)
  .sandbox(driver)
  .tool(tool)
  .delegate(agent)
  .mcp(connection)
  .memory(driver)
  .channel(driver)
  .serve({ path: "/mcp" })
  .schedule(schedule)
  .on(event, handler)
  .approve(handler)
  .start();
```

Fluent agent methods configure only. I/O and timers begin at `.start()`.

## Model calls

`AgentConfig` requires a configured `model` dependency and `persona`. It supports `maxSteps`, streaming, reasoning effort, and structured `.ask(schema)` output. The xsAI and deterministic mock models are explicit subpath factories; tests never consume AI tokens.

## Hono backbone

Every running agent exposes:

- `agent.app`: the shared Hono application.
- `agent.fetch(request)`: a web-standard fetch handler.
- `GET /health`: readiness.
- `POST /invoke`: JSON invocation.
- `/mcp`: mounted by `.serve()`.

XSAF mounts routes only and does not open sockets. Deployment is owned by the host runtime. The MCP endpoint accepts MCP `2026-07-28` traffic only; legacy protocol traffic is rejected. Hono host/origin protections remain enabled.

## Tools

Tools require:

- A snake_case name and description.
- A schema implementing both Standard Schema V1 validation and Standard JSON Schema V1 conversion.
- An execute function.

JSON Schema is advertised to xsAI and MCP clients. Runtime arguments are validated before approval and execution. Tool execution centralizes approval, cancellation, timeout, classified retries, sandboxing, errors, and events.

## Sandboxing

Executable local, delegated, and MCP tools require an explicit sandbox. XSAF has no implicit host-execution fallback.

- Production users should register an AgentOS-compatible `XsafSandboxDriver`.
- `@xsaf/agent/sandbox/local` is an explicit no-isolation opt-in and requires `{ unsafe: true }`.

## Approvals

`approval: "human"` uses privileged handlers registered with `.approve(handler)`. Approval handlers receive validated arguments. Ordinary `approval.required` events contain only the tool and session identifiers and are safe for general telemetry.

MCP servers default to `untrusted`; their tools require approval unless `trust: "trusted"` is explicit.

## MCP

`@xsaf/agent/mcp` provides a built-in HTTP client for MCP v2. It discovers tools, resources, and prompts over the `2026-07-28` per-request protocol. No client adapter is required. MCP tools merge into the same execution loop as local tools and delegates.

`.serve()` uses the official MCP server and Hono packages. Local tools are exposed through `tools/list` and `tools/call` with their real JSON Schema.

## Channels

Alpha bundles:

- `@xsaf/agent/channel/mock` for deterministic tests.
- `@xsaf/agent/channel/http` mounted on the shared Hono app, with JSON responses and SSE for streamed responses.
- `@xsaf/agent/channel/chat-sdk` which bridges the universal `chat` package (Chat SDK) to natively support Slack, Teams, Discord, Telegram, Google Chat, and other platforms.

Other custom channels are post-alpha adapters.

## Memory and concurrency

The default memory driver is in-memory. Drivers may provide durable storage. Optional peer-backed adapters:

- `@xsaf/agent/memory/db0` wraps a [db0](https://db0.unjs.io/) `Database`. Messages are stored as SQL rows; `.search({ query, sessionId?, limit? })` runs a substring `LIKE` across sessions by default (optional `sessionId` narrows).
- `@xsaf/agent/memory/unstorage` wraps an [unstorage](https://unstorage.unjs.io/) `Storage` for KV backends (filesystem, Redis, Cloudflare, and others).

Requests sharing a `sessionId` are serialized; different sessions may run concurrently. Memory failures fail the request.

## Delegation

Agents define a snake_case `name` and optional description in `AgentConfig`. `.delegate()` seals the configured child and exposes it as a model-visible tool. Parent history is not forwarded unless `passContext: true`. Delegate lifecycle events are emitted on the parent event bus.

## Scheduling

Schedules use five-field cron expressions and the normal request path. Overlapping ticks are skipped. Events include `heartbeat.fired`, `heartbeat.completed`, and `heartbeat.failed`.

## Lifecycle

Startup is coalesced and cleans partially initialized resources on failure. Shutdown is idempotent, sequential, and reverse-order. All resources are attempted; failures are reported as an `AggregateError`.

## Package policy

- ESM-only output built with tsdown.
- Standard Schema interfaces are vendored from standardschema.dev.
- Root runtime dependencies intentionally include xsAI, Hono, and the official MCP server/Hono packages.
- Formatting uses oxfmt; linting uses oxlint.
- CI runs typecheck, lint, formatting checks, bun:test, build, and a built-package smoke test.

## Post-alpha

AgentOS implementation packages, socket listeners, stdio MCP, distributed scheduling, workflow durability, multi-tenant auth, rate limiting, CLI scaffolding, and dashboards are outside alpha scope.
