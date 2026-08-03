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
  .serve({ transport: "http", path: "/mcp" })
  .schedule(schedule)
  .on(event, handler)
  .approve(handler)
  .start();
```

Builder methods configure only. I/O and timers begin at `.start()`.

## Model calls

`AgentConfig` requires `model`, `baseURL`, `apiKey`, and `persona`. It supports `maxSteps`, streaming, reasoning effort, a custom model adapter, and structured `.ask(schema)` output. The default adapter uses xsAI. Tests use injected deterministic model adapters and never consume AI tokens.

## Hono backbone

Every running agent exposes:

- `agent.app`: the shared Hono application.
- `agent.fetch(request)`: a web-standard fetch handler.
- `GET /health`: readiness.
- `POST /invoke`: JSON invocation.
- `/mcp`: mounted by `.serve({ transport: "http" })`.

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
- `xsaf/sandbox/local` is an explicit no-isolation opt-in.
- `xsaf/sandbox/host` remains a compatibility alias requiring an unsafe acknowledgement.

## Approvals

`approval: "human"` uses privileged handlers registered with `.approve(handler)`. Approval handlers receive validated arguments. Ordinary `approval.required` events contain only the tool and session identifiers and are safe for general telemetry.

MCP servers default to `untrusted`; their tools require approval unless `trust: "trusted"` is explicit.

## MCP

`xsaf/mcp` provides a built-in HTTP client for MCP v2. It discovers tools, resources, and prompts over the `2026-07-28` per-request protocol. No client adapter is required. MCP tools merge into the same execution loop as local tools and delegates.

`.serve()` uses the official MCP server and Hono packages. Local tools are exposed through `tools/list` and `tools/call` with their real JSON Schema.

## Channels

Alpha bundles:

- `xsaf/channel/mock` for deterministic tests.
- `xsaf/channel/http` mounted on the shared Hono app, with JSON responses and SSE for streamed responses.

Other chat-platform channels are post-alpha adapters.

## Memory and concurrency

The default memory driver is in-memory. Drivers may provide durable storage. Requests sharing a `sessionId` are serialized; different sessions may run concurrently. Memory failures fail the request.

## Delegation

`.asAgent(name)` seals a reusable agent. `.delegate()` exposes it as a model-visible tool. Parent history is not forwarded unless `passContext: true`. Delegate lifecycle events are emitted on the parent event bus.

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

AgentOS implementation packages, SQLite memory, Telegram/Discord/Slack/WebSocket channels, socket listeners, stdio MCP, distributed scheduling, workflow durability, multi-tenant auth, rate limiting, CLI scaffolding, and dashboards are outside alpha scope.
