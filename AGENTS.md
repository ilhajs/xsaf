# AGENTS.md — XSAF

## Mission

Build **XSAF (Extra Small Agent Framework)**: a minimal, fluent TypeScript orchestration layer over xsAI. It coordinates model calls, Standard Schema tools, driver-based channels/memory/MCP/scheduling, and explicitly configured sandbox execution. It is not a workflow engine.

The product specification is the target API, not proof that every named upstream API/package exists. Verify integrations against installed types and current official docs before coding.

## Priorities

1. Correct types and lifecycle behavior.
2. Small, dependency-light, tree-shakeable core.
3. Secure defaults at trust boundaries.
4. Structural driver interoperability.
5. Optional integrations only after core stability.

Out of scope: durable workflows/replay, distributed scheduling, multi-tenant auth, automatic compaction, scaffold CLI, channel rate limiting, dashboards, and built-in container/browser parity.

## Architecture

Use a Bun workspace with independently publishable packages:

```text
packages/
  xsaf/                    # core package and optional subpath adapters
    src/
      core/                # builder, sealed agent, runtime, lifecycle
      drivers/             # public structural contracts
      events/              # typed event bus
      memory/              # in-memory default
      scheduler/           # single-process scheduling
      channel/             # bundled channel adapters
      mcp/                 # MCP host/client adapter
      sandbox/             # opt-in adapters
      serve/               # MCP server exposure
      index.ts             # minimal root export
    test/
  xsaf-memory-sqlite/      # optional durable memory
```

Create directories only when needed; do not add placeholders that imply unsupported behavior.

### Dependency boundaries

The published core uses `xsai` for model calls and Hono plus the MCP TypeScript SDK as its request/transport backbone. Vendor the type-only Standard Schema V1 and Standard JSON Schema V1 contracts from standardschema.dev instead of depending on `@standard-schema/spec`. Keep Node/Bun-specific listeners, cron parsers, databases, and sandbox runtimes behind adapters or subpath exports; the Hono fetch app and MCP HTTP transport are intentional root capabilities.

- Use `import type` for types.
- Never import optional adapters from `src/index.ts`.
- Keep driver contracts independent of implementation packages.
- Prefer platform APIs over trivial utility dependencies.
- Document why each new dependency is necessary.
- Reassess scaffold dependencies before retaining them.

## Public Contract

Target chain:

```ts
xsaf
  .agent(config)
  .sandbox(driver)
  .tool(config)
  .delegate(agent, options)
  .mcp(driver)
  .memory(driver)
  .channel(driver)
  .serve(config)
  .schedule(config)
  .on(event, handler)
  .start();
```

Rules:

- Builder methods only configure; no I/O/background work before `.start()`.
- `.agent()` validates required config eagerly.
- `.asAgent(name, description?)` returns a sealed reusable agent.
- `.start()` rejects/handles double start predictably; `.stop()` is idempotent and safe after partial startup.
- Start resources in declaration order when relevant; stop in reverse order.
- Failed startup closes resources already started.
- Reject duplicate tool/driver names unless replacement is explicitly designed.
- Expose readonly views, not mutable registries.
- Do not expand the public API without an ADR/issue.

Keep public drivers narrow and structurally typed. Tool schemas must implement both Standard Schema validation and Standard JSON Schema conversion; infer validated input where practical.

## Runtime Invariants

- One request path handles channel messages, schedules, and direct invocation.
- Memory persists inbound/outbound messages by session.
- Local tools, delegated agents, and MCP tools become one model-visible tool shape.
- Centralize this order: validate input → approval → timeout/retry policy → sandbox execution → error handling/events.
- Never retry invalid input or denied approval.
- Delegates receive no parent history, tools, memory, or permissions unless explicitly enabled.
- Streaming preserves backpressure; do not buffer an `AsyncIterable` eagerly.
- Event handlers must not corrupt runtime state.

Initial events:

```text
tool.called tool.failed delegate.started delegate.completed
message.sent approval.required approval.granted mcp.connected
heartbeat.fired heartbeat.completed heartbeat.failed sandbox.escalated sandbox.denied
```

Use discriminated, stable, secret-safe payloads.

## Security

- Filesystem, network, and shell permissions default to denied.
- MCP servers default to `untrusted`; sourced tools require human approval.
- Never log API keys, bearer tokens, authorization headers, or raw secrets.
- Treat channel metadata, MCP payloads, tool args, and memory as untrusted.
- Host-process/no-isolation mode must be explicit and documented.
- Do not claim isolation, host bindings, MCP compliance, or permission enforcement without integration tests.

## Verify Before Implementing

Check installed types and current official documentation for:

- xsAI model/provider setup, text/object streaming, tools, and multi-step APIs.
- Standard Schema validation/inference contracts.
- The actual AgentOS package, isolation model, permissions, and host functions.
- MCP `2026-07-28` behavior and SDK transports. Alpha is modern-only and must reject legacy protocol traffic.
- Adapter runtime support, licenses, and bundle impact.

Contain volatile upstream APIs in small compatibility modules.

## Implementation Order

1. Workspace/package metadata, strict config, canonical scripts, public types.
2. Builder, eager validation, `.asAgent()`, lifecycle state machine.
3. Request path, event bus, in-memory memory, mock channel.
4. Tool validation, approvals, timeout/retry/error policy, executor.
5. Delegation boundaries.
6. xsAI adapter: non-streaming, then streaming/structured output.
7. Deterministic scheduler, then cron adapter.
8. MCP client/trust policy, then server exposure.
9. Sandbox/channel adapters.
10. Export maps, declarations, tree-shaking, bundle checks.

Implement one slice at a time. Stabilize contracts with fakes before live integrations.

## Testing

Use Bun's test runner unless a real requirement dictates otherwise. Prioritize:

- Compile-time fluent API/schema inference.
- No effects before `.start()`.
- Lifecycle idempotency and failed-start cleanup.
- Tool pipeline ordering and retry/timeout behavior.
- Untrusted MCP approval defaults.
- Delegate context/permission isolation.
- Memory ordering/session separation.
- Streaming without buffering.
- Fake-clock schedule tests.
- Export-map and optional-adapter isolation smoke tests.

Default tests must not require network access. Put live tests behind explicit environment flags.

Canonical root commands once scripts exist:

```bash
bun install
bun run typecheck
bun test
bun run lint
bun run build
```

Never invent missing scripts or report checks not run.

## Token-Efficient Workflow

1. Read this file, `package.json`, then only task-relevant files.
2. Inspect symbols/outlines before large files; search identifiers instead of dumping trees.
3. Never read `node_modules`, lockfiles, generated output, coverage, or build artifacts unless directly relevant.
4. Keep work to one architectural slice and reuse the centralized runtime/tool path.
5. Run the narrowest check first; summarize large output to failures only.
6. Do not reread unchanged files.
7. For unfamiliar multi-file behavior, use a read-only worker and request conclusions, not raw output.
8. Keep plans to goal, affected files, and acceptance checks.
9. Finish with changed paths, checks run, and unresolved risks—no transcript recap.

## Code Style

- Strict TypeScript; never weaken compiler settings globally.
- No `any` in public contracts; use `unknown`, generics, and narrowing.
- Prefer small pure functions and explicit state transitions.
- Avoid generic `utils.ts` dumping grounds.
- Add TSDoc where public behavior/security implications are non-obvious.
- Classify errors enough for retry/event policy without leaking secrets.
- Comments explain decisions, not syntax.

## Definition of Done

- Dependency/security boundaries remain intact.
- Public behavior and types have focused tests.
- Relevant typecheck/tests/build pass.
- Exports are intentional and documented.
- Optional integrations stay out of the root graph.
- No secrets, generated files, or unrelated lockfile churn.
- Unverified assumptions and residual risks are stated.
