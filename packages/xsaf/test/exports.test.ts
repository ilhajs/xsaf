import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkgRoot = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
  files: string[];
};
const rootSource = readFileSync(join(pkgRoot, "src/index.ts"), "utf8");

const expectedSubpaths = [
  ".",
  "./channel/chat-sdk",
  "./channel/http",
  "./channel/mock",
  "./model/mock",
  "./model/xsai",
  "./memory/in-memory",
  "./memory/db0",
  "./memory/unstorage",
  "./scheduler/cron",
  "./sandbox/local",
  "./mcp",
  "./types",
] as const;

describe("export map and optional adapter isolation", () => {
  test("package exports declare the published subpaths", () => {
    expect(Object.keys(pkg.exports).sort()).toEqual([...expectedSubpaths].sort());
  });

  test("package files include SPEC.md and the packaged copy resolves", () => {
    expect(pkg.files).toContain("SPEC.md");
    const spec = readFileSync(join(pkgRoot, "SPEC.md"), "utf8");
    expect(spec).toContain("# XSAF Alpha Specification");
  });

  test("root entry does not import optional adapters", () => {
    expect(rootSource).not.toMatch(/from ["']\.\/(channel|memory|sandbox|scheduler|mcp)\//);
  });

  test("optional adapters load independently from source subpaths", async () => {
    const local = (await import("../src/sandbox/local")).default;
    expect(() => local({} as { unsafe: true })).toThrow(/unsafe: true/);
    expect(local({ unsafe: true }).name).toBe("unsafe_local");

    const { inMemory } = await import("../src/memory/in-memory");
    expect(typeof inMemory).toBe("function");

    const { db0 } = await import("../src/memory/db0");
    expect(typeof db0).toBe("function");

    const { unstorage } = await import("../src/memory/unstorage");
    expect(typeof unstorage).toBe("function");

    const { cron } = await import("../src/scheduler/cron");
    expect(typeof cron).toBe("function");

    const mcp = (await import("../src/mcp")).default;
    expect(typeof mcp).toBe("function");

    const chatSdk = (await import("../src/channel/chat-sdk")).default;
    expect(typeof chatSdk).toBe("function");

    const http = (await import("../src/channel/http")).default;
    expect(typeof http).toBe("function");

    const mockChannel = (await import("../src/channel/mock")).default;
    expect(typeof mockChannel).toBe("function");
  });
});
