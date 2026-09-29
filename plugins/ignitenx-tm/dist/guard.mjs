import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// src/tool-names.ts
var TOOL_NAMES = ["tpa_get_identity", "tpa_get_options", "tpa_submit_request"];
var SERVER_PREFIX = "mcp__plugin_ignitenx-tm_tpa-mcp__";
function qualified(name) {
  return `${SERVER_PREFIX}${name}`;
}

// src/guard.ts
var ALLOWED_TOOLS = new Set(TOOL_NAMES.map(qualified));
function decide(stdin) {
  let toolName;
  try {
    toolName = JSON.parse(stdin).tool_name;
  } catch {
    toolName = void 0;
  }
  if (typeof toolName === "string" && ALLOWED_TOOLS.has(toolName)) {
    return { allow: true };
  }
  const shown = typeof toolName === "string" ? toolName.slice(0, 200) : "an unrecognised tool call";
  return {
    allow: false,
    reason: `ignitenx-tm allows only its own tpa_* tools; ${shown} is blocked. Continue with the tpa_* tools, or stop and report.`
  };
}

// src/bin/guard.ts
var decision;
try {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  decision = decide(Buffer.concat(chunks).toString("utf8"));
} catch {
  decision = decide("");
}
if (decision.allow) {
  process.exit(0);
}
process.stderr.write(`${decision.reason ?? "ignitenx-tm blocked this tool call."}
`);
process.exit(2);
