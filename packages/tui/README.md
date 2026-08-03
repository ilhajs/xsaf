# @xsaf/tui

A focused terminal chat interface for XSAF agents, built with Pi TUI.

It provides a bordered multiline prompt, Markdown conversation history, streaming responses, animated working state, prompt history, and automatic tool/delegate status rows.

## Install

```sh
bun add @xsaf/agent @xsaf/tui
```

`@xsaf/tui` uses `@earendil-works/pi-tui` and requires Node.js 22.19 or newer. Bun is supported.

## Usage

```ts
import tui from "@xsaf/tui";

const builder = xsaf.agent({
  ...config,
  name: "workspace_agent",
});
await builder.start();

const chat = tui({
  agent: builder,
  onExit: () => builder.stop(),
});

chat.start();
```

The supplied agent must expose the normal XSAF builder `name`, `invoke()`, and `on()` members. A configured agent name is required and labels the header and assistant messages. Tool and delegate events are observed automatically.

## Features

- Pi-style multiline editor
- Enter to submit and Shift+Enter for new lines
- Prompt history
- Markdown messages and code blocks
- Incremental streaming output
- Animated working indicator
- Tool running, completed, and failed states
- Delegate running and completed states
- Custom messages and tool results
- Custom terminal and theme support
- Idempotent asynchronous shutdown

## Custom output

```ts
chat.addMessage("System", "Connected to the workspace.");
chat.addToolResult("read_file", { path: "README.md", lines: 120 });
chat.setStatus("sync", "Synchronizing", "running");
```

Tool arguments and outputs are not copied from general XSAF telemetry. This avoids leaking sensitive values. Call `addToolResult()` explicitly when displaying a result is appropriate for your application.
