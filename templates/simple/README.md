# XSAF simple template

A minimal HTTP agent built with XSAF and srvx.

## Run

From `templates/simple`:

```sh
npm install
npm run build
npm start
```

The template starts an srvx server on port `3000` and exposes the XSAF Hono application:

- `GET /health` — readiness response
- `POST /invoke` — invoke the agent over HTTP
- `/mcp` — MCP v2 endpoint
- `Ctrl+C` — stop the HTTP server and agent cleanly

Invoke the agent with:

```sh
curl http://localhost:3000/invoke \
  --request POST \
  --header 'content-type: application/json' \
  --data '{"sessionId":"demo","prompt":"hello xsaf"}'
```

Expected response:

```json
{
  "text": "Mock assistant received: hello xsaf"
}
```

The default model is deterministic and makes no network or AI-provider requests. Replace `mockModel` in `agent.ts` with your model configuration when you are ready to connect a provider.

Set a different port with:

```sh
PORT=4000 npm start
```
