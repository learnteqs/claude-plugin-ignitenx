// Bundles the MCP server and the tool guard into self-contained files under dist/, which are committed so that
// installing the plugin needs no npm install and downloads no binaries.
import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  legalComments: "none",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
};

await build({ ...shared, entryPoints: ["src/bin/tpa-mcp.ts"], outfile: "dist/tpa-mcp.mjs" });
await build({ ...shared, entryPoints: ["src/bin/guard.ts"], outfile: "dist/guard.mjs" });
