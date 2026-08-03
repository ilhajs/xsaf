import { createMcpHonoApp } from "@modelcontextprotocol/hono";
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
/** Hono request backbone shared by agent HTTP and MCP traffic. */
export declare class HonoBackbone {
  #private;
  readonly app: ReturnType<typeof createMcpHonoApp>;
  constructor(options: HonoBackboneOptions);
  fetch(request: Request): Promise<Response>;
  mountMcp(options: MountMcpOptions): Promise<void>;
  close(): Promise<void>;
}
