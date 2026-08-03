import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "channel/http": "src/channel/http.ts",
    "channel/mock": "src/channel/mock.ts",
    "model/mock": "src/model/mock.ts",
    "sandbox/local": "src/sandbox/local.ts",
    "sandbox/host": "src/sandbox/host.ts",
    "mcp/index": "src/mcp/index.ts",
  },
  format: "esm",
  dts: true,
  clean: true,
  outDir: "dist",
  sourcemap: true,
});
