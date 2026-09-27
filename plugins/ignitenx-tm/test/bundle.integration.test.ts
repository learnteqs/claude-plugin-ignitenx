// Runs the committed bundles as real processes: the server over stdio against a stand-in TM, and the hook with stdin.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { TEST_KEY, TEST_TOKEN, meFor, startFakeTM, type FakeTM } from "./fake-tm.js";

const dist = (name: string) => fileURLToPath(new URL(`../dist/${name}`, import.meta.url));

describe("bundled tpa-mcp server", () => {
  let tm: FakeTM;
  let client: Client;
  let stderr = "";

  beforeEach(async () => {
    expect(existsSync(dist("tpa-mcp.mjs")), "run npm run build first").toBe(true);
    tm = await startFakeTM();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [dist("tpa-mcp.mjs")],
      env: { TM_BASE_URL: tm.url, TM_AGENT_KEY: TEST_KEY, PATH: process.env.PATH ?? "" },
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    client = new Client({ name: "bundle-test", version: "0" });
    await client.connect(transport);
  });

  afterEach(async () => {
    await client.close();
    await tm.close();
  });

  test("offers only tpa_get_identity and returns the key's identity", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["tpa_get_identity"]);

    const result = await client.callTool({ name: "tpa_get_identity", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ keyName: "provisioning-agent", permissions: ["partners.view", "plans.view"] });
    const everything = JSON.stringify(result) + stderr;
    expect(everything).not.toContain(TEST_KEY);
    expect(everything).not.toContain(TEST_TOKEN);
  });

  test("tells the agent to stop when the key is over-privileged", async () => {
    tm.me = meFor(["plans.view", "db.view"]);
    const result = await client.callTool({ name: "tpa_get_identity", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("refused");
    expect(JSON.stringify(result.content)).toContain("db.view");
  });
});

describe("bundled guard hook", () => {
  const run = (stdin: string) => spawnSync(process.execPath, [dist("guard.mjs")], { input: stdin, encoding: "utf8" });

  test("exits 0 silently for a tpa tool and exits 2 with the reason on stderr for anything else", () => {
    const allowed = run(JSON.stringify({ tool_name: "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_identity" }));
    expect(allowed.status).toBe(0);
    expect(allowed.stdout + allowed.stderr).toBe("");

    for (const stdin of [JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }), "garbage", ""]) {
      const denied = run(stdin);
      expect(denied.status).toBe(2);
      expect(denied.stderr).toContain("ignitenx-tm allows only its own tpa_* tools");
    }
  });

  test("the hooks.json invocation, run as Claude Code runs it, blocks with exit 2", () => {
    const hooks = JSON.parse(readFileSync(new URL("../hooks/hooks.json", import.meta.url), "utf8"));
    const { command, args } = hooks.hooks.PreToolUse[0].hooks[0] as { command: string; args: string[] };
    const root = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
    const argv = args.map((a) => a.replace("${CLAUDE_PLUGIN_ROOT}", root));
    const run = (tool: string) =>
      spawnSync(command === "node" ? process.execPath : command, argv, { input: JSON.stringify({ tool_name: tool }), encoding: "utf8" });
    expect(run("Bash").status).toBe(2);
    expect(run("mcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_identity").status).toBe(0);
  });
});
