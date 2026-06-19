// Build a self-contained distribution of the adlx CLI and library entry point.
//
// @adl/core and @adl/protocol are unpublished workspace packages, so we inline them (along with
// zod and any other runtime deps) into the output via esbuild. The resulting tarball has zero
// runtime dependencies and needs no sibling repo to run.
import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  logLevel: "info",
  // Node built-ins are resolved at runtime, never bundled.
  external: ["node:*"],
};

// The CLI entry. cli.ts carries the `#!/usr/bin/env node` hashbang, which esbuild preserves.
await build({
  ...shared,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
});

// The library entry, for programmatic consumers.
await build({
  ...shared,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
});

console.log("build: wrote dist/cli.js and dist/index.js");
