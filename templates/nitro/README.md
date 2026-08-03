### XSAF TUI template

## Run the server

From `templates/nitro`:

```sh
cp .env.example .env
npm install
npm run dev
```

Nitro owns the only agent instance and serves:

- `GET /health` — readiness response
- `POST /chat` — authenticated streaming chat endpoint
- `POST /invoke` — invoke the agent over HTTP
- `/mcp` — MCP v2 endpoint

For a production-style build:

```sh
npm run build
npm start
```

Set a different Nitro port with `PORT=4000 npm start`.

## Open the standalone TUI

Install `@xsaf/cli` globally or run the template's installed binary from another terminal:

```sh
API_KEY=asd123 xsaf -u http://localhost:3000
```

```sh
API_KEY=asd123 npx --package @xsaf/cli xsaf -u http://localhost:3000
```

The CLI owns stdin and stdout while Nitro remains a headless server. Prompts, streamed response chunks, tool statuses, and delegate statuses travel over the authenticated `/chat` SSE response. The CLI's `API_KEY` must match `XSAF_CHAT_KEY` in the server environment.

Useful options:

```text
-u, --url       XSAF server base URL
-s, --session   Session identifier (default: tui)
--name           Agent name shown in the terminal
```
