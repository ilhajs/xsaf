# @xsaf/cli

Standalone interactive terminal client for XSAF agents.

## Install

```sh
npm install --global @xsaf/cli
```

Node.js 22.19 or newer is required.

## CLI

Connect to an agent exposing the XSAF HTTP channel:

```sh
API_KEY=asd123 xsaf -u http://localhost:3000
```

Options:

```text
-u, --url       XSAF server base URL (default: http://localhost:3000)
-s, --session   Session identifier (default: tui)
--name           Agent name shown in the terminal (default: xsaf)
```

The CLI sends prompts to `POST /chat` and consumes its SSE response. Text chunks, tool activity, and delegate activity render as they arrive. `API_KEY`, when present, is sent as a bearer token.

## Server setup

```ts
import { agent } from "@xsaf/agent";
import http from "@xsaf/agent/channel/http";

const bot = agent(config).channel(http({ path: "/chat", apiKey: process.env.API_KEY }));

await bot.start();
```

## Embedded usage

The rendering factory remains available for applications that intentionally host a local agent:

```ts
import tui from "@xsaf/cli";

const chat = tui({ agent });
chat.start();
```

The factory returns a controller with `start()`, `stop()`, `submit()`, `addMessage()`, and `setStatus()`.
