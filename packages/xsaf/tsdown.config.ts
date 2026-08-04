import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "channel/chat-sdk": "src/channel/chat-sdk.ts",
    "channel/http": "src/channel/http.ts",
    "channel/mock": "src/channel/mock.ts",
    "model/mock": "src/model/mock.ts",
    "model/xsai": "src/model/xsai.ts",
    "memory/in-memory": "src/memory/in-memory.ts",
    "memory/db0": "src/memory/db0.ts",
    "memory/unstorage": "src/memory/unstorage.ts",
    "scheduler/cron": "src/scheduler/cron.ts",
    "sandbox/local": "src/sandbox/local.ts",
    "mcp/index": "src/mcp/index.ts",
    types: "src/types.ts",
  },
  format: "esm",
  dts: true,
  clean: true,
  outDir: "dist",
  sourcemap: true,
});
