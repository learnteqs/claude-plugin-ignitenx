// PreToolUse hook: denies every tool except this plugin's own tpa_* tools, including built-in tools, other plugins' tools
// and claude.ai connectors. Anything it cannot parse is denied too.
import { TOOL_NAMES, qualified } from "./tool-names.js";

// Exact names, not a pattern: a server someone else names plugin_ignitenx-tm_tpa-mcp would otherwise pass for this one.
export const ALLOWED_TOOLS: ReadonlySet<string> = new Set(TOOL_NAMES.map(qualified));

export interface Decision {
  allow: boolean;
  reason?: string;
}

export function decide(stdin: string): Decision {
  let toolName: unknown;
  try {
    toolName = (JSON.parse(stdin) as { tool_name?: unknown }).tool_name;
  } catch {
    toolName = undefined;
  }
  if (typeof toolName === "string" && ALLOWED_TOOLS.has(toolName)) {
    return { allow: true };
  }
  const shown = typeof toolName === "string" ? toolName.slice(0, 200) : "an unrecognised tool call";
  return {
    allow: false,
    reason: `ignitenx-tm allows only its own tpa_* tools; ${shown} is blocked. Continue with the tpa_* tools, or stop and report.`,
  };
}
