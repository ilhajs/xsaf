import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { XsafToolSchema } from "../standard-schema";
import type { McpConnection, McpContext, McpToolDefinition, XsafMcpDriver } from "../types";

const PROTOCOL_VERSION = "2026-07-28";

export type McpFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface McpDriverOptions {
  readonly name: string;
  readonly transport: "http";
  readonly url: string;
  readonly auth?: { readonly type: "bearer"; readonly token: string };
  readonly trust?: "trusted" | "untrusted";
  /** Test/runtime seam; defaults to globalThis.fetch. */
  readonly fetch?: McpFetch;
}

interface JsonRpcResponse<Result> {
  readonly result?: Result;
  readonly error?: { readonly code: number; readonly message: string };
}

interface RemoteTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
}

class HttpMcpDriver implements XsafMcpDriver {
  readonly name: string;
  readonly trust: "trusted" | "untrusted";
  readonly #options: McpDriverOptions;
  #requestId = 0;

  constructor(options: McpDriverOptions) {
    if (!options.name.trim()) throw new TypeError("MCP name is required");
    if (!options.url.trim()) throw new TypeError("HTTP MCP requires url");
    this.name = options.name;
    this.trust = options.trust ?? "untrusted";
    this.#options = options;
  }

  async connect(_context: McpContext): Promise<McpConnection> {
    const listed = await this.#request<{ readonly tools?: readonly RemoteTool[] }>(
      "tools/list",
      {},
    );
    const tools = (listed.tools ?? []).map(
      (tool): McpToolDefinition => ({
        name: tool.name,
        description: tool.description ?? `MCP tool ${tool.name}`,
        input: fromJsonSchema(
          tool.inputSchema ?? { type: "object", additionalProperties: true },
        ) as XsafToolSchema,
        execute: async (args) => {
          const result = await this.#request<unknown>(
            "tools/call",
            { name: tool.name, arguments: args },
            tool.name,
          );
          return result;
        },
      }),
    );
    return {
      tools,
      resources: {
        get: (uri) => this.#request("resources/read", { uri }),
      },
      prompts: {
        get: async (name, args) => {
          const result = await this.#request<{ messages?: unknown }>(
            "prompts/get",
            { name, arguments: args ?? {} },
            name,
          );
          return JSON.stringify(result.messages ?? result);
        },
      },
    };
  }

  async #request<Result>(
    method: string,
    params: Readonly<Record<string, unknown>>,
    name?: string,
  ): Promise<Result> {
    const fetcher: McpFetch = this.#options.fetch ?? globalThis.fetch;
    const headers = new Headers({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
      "Mcp-Method": method,
    });
    if (name) headers.set("Mcp-Name", name);
    if (this.#options.auth) headers.set("authorization", `Bearer ${this.#options.auth.token}`);
    const response = await fetcher(this.#options.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.#requestId,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientInfo": {
              name: "xsaf",
              version: "0.1.0-alpha.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    const payload = (await response.json()) as JsonRpcResponse<Result>;
    if (!response.ok || payload.error)
      throw new Error(payload.error?.message ?? `MCP HTTP ${response.status}`);
    if (payload.result === undefined) throw new Error("MCP response has no result");
    return payload.result;
  }
}

export default function mcp(options: McpDriverOptions): XsafMcpDriver {
  return new HttpMcpDriver(options);
}
