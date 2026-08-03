# XSAF TUI template

A minimal interactive terminal agent built with XSAF, `@xsaf/tui`, and srvx.

## Run

From `templates/tui`:

```sh
npm install
npm run dev
```

Development runs `agent.ts` directly with Node's watch mode, avoiding a full bundle and process-tree restart after every edit.

For a production-style build:

```sh
npm run build
npm start
```

`@xsaf/tui` owns the prompt, Markdown history, streaming output, and tool/delegate statuses. Type a prompt in the bordered multiline editor and press Enter to submit. Use Shift+Enter for a new line. Submitted prompts are kept in editor history. User and agent messages render as themed Markdown, including lists, links, quotes, and code blocks, with an animated working indicator while the agent responds. The same XSAF agent remains available through an srvx HTTP server.

- `GET /health` — readiness response
- `POST /invoke` — invoke the agent over HTTP
- `/mcp` — MCP v2 endpoint
- `Ctrl+C` — stop the TUI, HTTP server, and agent cleanly

The default model is deterministic and makes no network or AI-provider requests. Replace `mockModel` in `agent.ts` with your model configuration when you are ready to connect a provider.

Set a different port with:

```sh
PORT=4000 npm start
```
