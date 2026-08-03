import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", http: "src/http.ts", cli: "src/cli.ts" },
  format: "esm",
  dts: true,
  clean: true,
  outDir: "dist",
  sourcemap: true,
  banner: ({ fileName }) => (fileName === "cli.mjs" ? "#!/usr/bin/env node" : undefined),
});
