// The server's tool names, in the order it registers them, and the names Claude Code gives them. It imports nothing, so
// the guard bundle stays small.
export const TOOL_NAMES = ["tpa_get_identity", "tpa_get_options", "tpa_submit_request"] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const SERVER_PREFIX = "mcp__plugin_ignitenx-tm_tpa-mcp__";

export function qualified(name: ToolName): string {
  return `${SERVER_PREFIX}${name}`;
}
