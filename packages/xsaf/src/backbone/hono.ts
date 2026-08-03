import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import type { AgentResult, ModelTool } from "../types";

export interface HonoBackboneOptions {
  readonly name?: string;
  readonly version?: string;
  readonly mcpPath?: string;
  readonly invokePath?: string;
  readonly invoke: (prompt: string, sessionId: string) => Promise<AgentResult>;
}

export interface MountMcpOptions {
  readonly name?: string;
  readonly version?: string;
  readonly path?: string;
  readonly tools: readonly ModelTool[];
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Hono request backbone shared by agent HTTP and MCP traffic. */
export class HonoBackbone {
  readonly app: ReturnType<typeof createMcpHonoApp>;
  readonly #defaults: Required<
    Pick<HonoBackboneOptions, "name" | "version" | "mcpPath" | "invokePath">
  >;
  readonly #mcpHandlers = new Map<string, McpHttpHandler>();
  readonly #mountedMcpPaths = new Set<string>();

  constructor(options: HonoBackboneOptions) {
    this.#defaults = {
      name: options.name ?? "xsaf",
      version: options.version ?? "0.1.0-alpha.0",
      mcpPath: options.mcpPath ?? "/mcp",
      invokePath: options.invokePath ?? "/invoke",
    };
    const app = createMcpHonoApp();
    app.get("/health", (context) => context.json({ ok: true }));
    app.post(this.#defaults.invokePath, async (context) => {
      const body = await context.req.json<{
        prompt?: unknown;
        sessionId?: unknown;
      }>();
      if (typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
        return context.json({ error: "prompt must be a non-empty string" }, 400);
      }
      const sessionId =
        typeof body.sessionId === "string" && body.sessionId.length > 0 ? body.sessionId : "http";
      return context.json(await options.invoke(body.prompt, sessionId));
    });
    this.app = app;
  }

  fetch(request: Request): Promise<Response> {
    return Promise.resolve(this.app.fetch(request));
  }

  async mountMcp(options: MountMcpOptions): Promise<void> {
    const path = options.path ?? this.#defaults.mcpPath;
    if (this.#mcpHandlers.has(path)) throw new Error(`MCP server is already mounted at ${path}`);
    const createServer = () => {
      const server = new McpServer({
        name: options.name ?? this.#defaults.name,
        version: options.version ?? this.#defaults.version,
      });
      for (const tool of options.tools) {
        server.registerTool(
          tool.name,
          {
            description: tool.description,
            inputSchema: fromJsonSchema(
              tool.input["~standard"].jsonSchema.input({
                target: "draft-07",
              }),
            ),
          },
          async (input) => {
            try {
              const output = await tool.execute(input);
              return { content: [{ type: "text", text: text(output) }] };
            } catch (error) {
              return {
                content: [
                  {
                    type: "text",
                    text: error instanceof Error ? error.message : "Tool failed",
                  },
                ],
                isError: true,
              };
            }
          },
        );
      }
      return server;
    };
    const handler = createMcpHandler(createServer, {
      legacy: "reject",
    });
    if (!this.#mountedMcpPaths.has(path)) {
      this.app.all(path, async (context) => {
        const active = this.#mcpHandlers.get(path);
        if (!active) return context.json({ error: "MCP server is stopped" }, 503);
        const parsedBody = (context as unknown as { get(key: "parsedBody"): unknown }).get(
          "parsedBody",
        );
        return await active.fetch(context.req.raw, { parsedBody });
      });
      this.#mountedMcpPaths.add(path);
    }
    this.#mcpHandlers.set(path, handler);
  }

  async close(): Promise<void> {
    const handlers = [...this.#mcpHandlers.values()];
    this.#mcpHandlers.clear();
    await Promise.allSettled(handlers.map((handler) => handler.close()));
  }
}
