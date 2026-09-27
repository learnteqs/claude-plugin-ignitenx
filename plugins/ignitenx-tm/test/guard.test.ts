import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { decide } from "../src/guard.js";

const call = (toolName: unknown) => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: toolName, tool_input: {} });

describe("guard", () => {
  test("lets this plugin's shipped tpa_* tools through to the normal permission check", () => {
    expect(decide(call("mcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_identity"))).toEqual({ allow: true });
  });

  test.each([
    "Bash",
    "PowerShell",
    "Read",
    "Write",
    "WebFetch",
    "Task",
    "ToolSearch",
    "mcp__claude_ai_Microsoft_365__outlook_send_mail",
    "mcp__plugin_ignitenx-lms_api__anything",
    "mcp__plugin_ignitenx-tm_other-server__tpa_get_identity",
    "mcp__plugin_ignitenx-tm_tpa-mcp__get_identity",
    "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_not_shipped_yet",
    "MCP__plugin_ignitenx-tm_tpa-mcp__tpa_get_identity",
    "xmcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_identity",
    "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_identity; rm -rf /",
  ])("denies %s with a reason", (tool) => {
    const decision = decide(call(tool));
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain("ignitenx-tm allows only its own tpa_* tools");
  });

  test.each(["", "not json", "{}", call(42), JSON.stringify([{ tool_name: "Bash" }])])(
    "denies an unparseable or nameless call %j",
    (stdin) => {
      expect(decide(stdin).allow).toBe(false);
    },
  );
});

describe("plugin wiring", () => {
  const read = (path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

  // Exec form, not a shell string: Windows PowerShell 5.1 runs shell-form hooks and rejects `||`, which Claude Code
  // treats as a non-blocking error that lets the tool run.
  test("the hook guards every tool through node directly, with no shell in between", () => {
    const pre = read("hooks/hooks.json").hooks.PreToolUse;
    expect(pre).toHaveLength(1);
    expect(pre[0].matcher).toBe("*");
    expect(pre[0].hooks).toEqual([{ type: "command", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/dist/guard.mjs"] }]);
  });

  test("the MCP server runs the committed bundle and carries no secrets in its config", () => {
    const servers = read(".mcp.json").mcpServers;
    expect(Object.keys(servers)).toEqual(["tpa-mcp"]);
    expect(servers["tpa-mcp"]).toEqual({ command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/dist/tpa-mcp.mjs"] });
  });
});
