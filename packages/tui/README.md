# @xsaf/tui

Interactive terminal chat for a configured XSAF agent.

## Install

```sh
bun add @xsaf/agent @xsaf/tui
```

Node.js 22.19 or newer is required.

## Usage

```ts
import { xsaf } from "@xsaf/agent";
import mockModel from "@xsaf/agent/model/mock";
import tui from "@xsaf/tui";

const agent = xsaf.agent({
  name: "workspace_agent",
  persona: "Be concise.",
  model: mockModel(),
});

await agent.start();

const chat = tui({
  agent,
  async onExit() {
    await agent.stop();
  },
});

chat.start();
```

The factory returns a small controller with `start()`, `stop()`, `submit()`, `addMessage()`, and `setStatus()`. Tool and delegate lifecycle events are observed automatically. General telemetry intentionally excludes tool arguments and results.
