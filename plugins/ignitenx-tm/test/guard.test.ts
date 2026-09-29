import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { ALLOWED_TOOLS, decide } from "../src/guard.js";
import { SERVER_PREFIX, TOOL_NAMES, qualified } from "../src/tool-names.js";

const call = (toolName: unknown) => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: toolName, tool_input: {} });

// Names that look like this plugin's tools but are not, each of which the guard must deny.
const LOOKALIKES = [
  "mcp__plugin_ignitenx-tm_other-server__tpa_get_options",
  "mcp__plugin_ignitenx-tm_tpa-mcp__TPA_GET_OPTIONS",
  "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_Submit_Request",
  "MCP__plugin_ignitenx-tm_tpa-mcp__tpa_get_identity",
  "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_submit",
  "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_options_all",
  "xmcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_options",
  "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_submit_shadow_request",
  "tpa_submit_request",
  "ToolSearch",
  "Skill",
];

describe("guard", () => {
  test("allows exactly the three qualified tool names", () => {
    expect([...ALLOWED_TOOLS]).toEqual([
      "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_identity",
      "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_options",
      "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_submit_request",
    ]);
    expect([...ALLOWED_TOOLS]).toEqual(TOOL_NAMES.map((n) => `${SERVER_PREFIX}${n}`));
  });

  test.each(TOOL_NAMES.map(qualified))("lets %s through to the normal permission check", (tool) => {
    expect(decide(call(tool))).toEqual({ allow: true });
  });

  test.each([
    ...LOOKALIKES,
    "Bash",
    "PowerShell",
    "Read",
    "Write",
    "WebFetch",
    "Task",
    "mcp__claude_ai_Microsoft_365__outlook_send_mail",
    "mcp__plugin_ignitenx-lms_api__anything",
    "mcp__plugin_ignitenx-tm_other-server__tpa_get_identity",
    "mcp__plugin_ignitenx-tm_tpa-mcp__get_identity",
    "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_not_shipped_yet",
    "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_identity; rm -rf /",
    " mcp__plugin_ignitenx-tm_tpa-mcp__tpa_submit_request",
    "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_submit_request\n",
  ])("denies %j with a reason", (tool) => {
    const decision = decide(call(tool));
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain("ignitenx-tm allows only its own tpa_* tools");
  });

  test.each(["", "not json", "{}", call(42), call(TOOL_NAMES.map(qualified)), JSON.stringify([{ tool_name: "Bash" }])])(
    "denies an unparseable or nameless call %j",
    (stdin) => {
      expect(decide(stdin).allow).toBe(false);
    },
  );

  test("tool-names.ts imports nothing, so the guard bundle carries no SDK", () => {
    const source = readFileSync(new URL("../src/tool-names.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\brequire\(/);
  });
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
