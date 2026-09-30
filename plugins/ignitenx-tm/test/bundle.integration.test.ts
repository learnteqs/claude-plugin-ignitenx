// Runs the committed bundles as real processes: the server over stdio against a stand-in TM, and the hook with stdin.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { getInstructions } from "../src/instructions.js";
import { normalizeText, redactRaw } from "../src/text.js";
import { TOOL_NAMES, qualified } from "../src/tool-names.js";
import {
  AGENT_PERMISSIONS,
  CANARIES,
  OPTIONS_VERSION,
  TEST_KEY,
  TEST_TOKEN,
  meFor,
  requestInput,
  startFakeTM,
  type FakeTM,
} from "./fake-tm.js";

const dist = (name: string) => fileURLToPath(new URL(`../dist/${name}`, import.meta.url));
const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string })
  .version;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const UI_URL = "http://localhost:5173";
const PASSWORD = "Zenith@2026!";
const HIDDEN = [
  { code: "bidi_control", count: 1 },
  { code: "zero_width", count: 1 },
  { code: "tag_character", count: 1 },
];

interface Result {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

// The contract request as the model would send it for a paste with CRLF line ends, zero-width, bidi and tag
// characters and a password; clean is the text TM must receive.
function pastedRequest(): { input: Record<string, unknown>; clean: string } {
  const input = requestInput();
  const withPassword = (input.sourceText as string).replace("\n\nThanks,", `\nTemporary password: ${PASSWORD}\n\nThanks,`);
  const [zwsp, rlo, tag] = [0x200b, 0x202e, 0xe0041].map((cp) => String.fromCodePoint(cp));
  input.sourceText = `  ${withPassword
    .replace("Acme Learning Pvt Ltd", `Acme Learn${zwsp}ing Pvt${tag} Ltd`)
    .replace("Standard plan", `Standard${rlo} plan`)
    .replaceAll("\n", "\r\n")}\r\n`;
  input.flags = [...(input.flags as unknown[]), { code: "secret_in_text", field: "", note: "A temporary password was pasted." }];
  return { input, clean: withPassword.replace(PASSWORD, "[redacted]") };
}

describe("bundled tpa-mcp server", () => {
  let tm: FakeTM;
  let client: Client;
  let stderr = "";
  let seen: Result[];

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as Result;
    seen.push(result);
    return result;
  };

  beforeEach(async () => {
    expect(existsSync(dist("tpa-mcp.mjs")), "run npm run build first").toBe(true);
    tm = await startFakeTM();
    tm.me = meFor(AGENT_PERMISSIONS);
    seen = [];
    stderr = "";
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [dist("tpa-mcp.mjs")],
      env: { TM_BASE_URL: tm.url, TM_AGENT_KEY: TEST_KEY, TM_UI_URL: UI_URL, PATH: process.env.PATH ?? "" },
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    client = new Client({ name: "bundle-test", version: "0" });
    await client.connect(transport);
  });

  afterEach(async () => {
    await client.close();
    await tm.close();
    const everything = JSON.stringify(seen) + stderr;
    for (const secret of [TEST_KEY, TEST_TOKEN, PASSWORD, ...CANARIES]) {
      expect(everything).not.toContain(secret);
    }
  });

  test("offers exactly the three tools, with the instructions and this version", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    expect(client.getServerVersion()).toMatchObject({ name: "tpa-mcp", version });
    expect(client.getInstructions()).toBe(getInstructions());
  });

  test("identity, options, then submit: TM receives the paste with only its secrets replaced, under a new ULID", async () => {
    const identity = await call("tpa_get_identity");
    expect(identity.isError).toBeFalsy();
    expect(identity.structuredContent).toMatchObject({ keyName: "provisioning-agent", permissions: AGENT_PERMISSIONS });

    const options = await call("tpa_get_options");
    expect(options.isError).toBeFalsy();
    expect(options.structuredContent).toMatchObject({
      environment: { name: "development", configured: true },
      partners: [{ id: "P-102", name: "Repute" }],
      servers: { postgres: [{ id: "local-pg", name: "local-pg", environmentMatch: true }] },
      placementPreview: { postgresServerId: { suggested: "local-pg", basis: "only_candidate" } },
    });

    const { input, clean } = pastedRequest();
    // The id's time comes from the server process, so allow for a little clock difference between processes.
    const before = Date.now() - 50;
    const submitted = await call("tpa_submit_request", input);
    expect(submitted.isError, JSON.stringify(submitted.content)).toBeFalsy();

    expect(tm.submissions).toHaveLength(1);
    const raw = tm.submissions[0] ?? "";
    const body = JSON.parse(raw) as Record<string, unknown> & {
      clientRequestId: string;
      fields: { title: { evidence: string[] }; subscription: { planId: { evidence: string[] } } };
      flags: { code: string }[];
    };
    expect(Object.keys(body)).toEqual([
      "clientRequestId",
      "schemaVersion",
      "clientOptionsVersion",
      "client",
      "sourceText",
      "summary",
      "triage",
      "fields",
      "flags",
    ]);
    expect(body.sourceText).toBe(redactRaw(input.sourceText as string).text);
    expect(raw).not.toContain(PASSWORD);
    expect(normalizeText(body.sourceText as string)).toEqual({ text: clean, stripped: HIDDEN });
    expect(body.fields.title.evidence).toEqual(["Acme Learning Pvt Ltd"]);
    expect(body.fields.subscription.planId.evidence).toEqual(["Standard plan"]);
    expect(body.flags.map((f) => f.code)).toEqual(["not_yet_confirmed", "secret_in_text"]);
    expect(body).toMatchObject({
      schemaVersion: 1,
      clientOptionsVersion: OPTIONS_VERSION,
      client: { name: "tpa-mcp", version },
      summary: input.summary,
      triage: input.triage,
    });
    expect(body.clientRequestId).toMatch(ULID);
    const made = [...body.clientRequestId.slice(0, 10)].reduce((ms, c) => ms * 32 + CROCKFORD.indexOf(c), 0);
    expect(made).toBeGreaterThanOrEqual(before);
    expect(made).toBeLessThanOrEqual(Date.now());

    const requestId = `pr-${body.clientRequestId}`;
    expect(submitted.structuredContent).toEqual({
      requestId,
      mode: "shadow",
      status: "recorded",
      readiness: "complete",
      replayed: false,
      checks: [
        { code: "tenant_key_available", result: "pass" },
        { code: "company_id_available", result: "unknown", severity: "warning", reason: "lookup_failed" },
        { code: "secret_scan", result: "fail", severity: "warning", count: 1 },
      ],
      redactions: [{ code: "password_line", count: 1 }],
      hiddenCharacters: HIDDEN,
      reviewUrl: `${UI_URL}/provisioning/requests/${requestId}`,
    });

    const again = await call("tpa_submit_request", input);
    expect(again.isError).toBe(true);
    expect(JSON.stringify(again.content)).toContain("already_submitted: start a new session for the next request");
    expect(tm.submissions).toHaveLength(1);
  });

  test("an over-privileged key stops the agent and reaches neither the options nor the requests", async () => {
    tm.me = meFor(["provisioning.submit", "db.view"]);
    const identity = await call("tpa_get_identity");
    expect(identity.isError).toBe(true);
    expect(JSON.stringify(identity.content)).toContain("refused");
    expect(JSON.stringify(identity.content)).toContain("db.view");
    expect((await call("tpa_get_options")).isError).toBe(true);
    expect((await call("tpa_submit_request", pastedRequest().input)).isError).toBe(true);
    expect(tm.requests.filter((r) => r.path.startsWith("/api/tm/provisioning/"))).toEqual([]);
  });
});

describe("bundled guard hook", () => {
  const run = (stdin: string) => spawnSync(process.execPath, [dist("guard.mjs")], { input: stdin, encoding: "utf8" });

  test.each(TOOL_NAMES.map(qualified))("exits 0 with no output for %s", (tool) => {
    const allowed = run(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: {} }));
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toBe("");
    expect(allowed.stderr).toBe("");
  });

  test.each([
    "mcp__plugin_ignitenx-tm_other-server__tpa_get_options",
    "mcp__plugin_ignitenx-tm_tpa-mcp__TPA_SUBMIT_REQUEST",
    "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_submit",
    "xmcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_options",
    "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_submit_shadow_request",
    "ToolSearch",
    "Skill",
    "Bash",
  ])("exits 2 with the reason on stderr for %s", (tool) => {
    const denied = run(JSON.stringify({ tool_name: tool, tool_input: {} }));
    expect(denied.status).toBe(2);
    expect(denied.stdout).toBe("");
    expect(denied.stderr).toContain("ignitenx-tm allows only its own tpa_* tools");
  });

  test.each(["garbage", ""])("exits 2 for unparseable input %j", (stdin) => {
    expect(run(stdin).status).toBe(2);
  });

  test("stays a few kilobytes, with no SDK or zod inside", () => {
    expect(statSync(dist("guard.mjs")).size).toBeLessThan(4096);
    const source = readFileSync(dist("guard.mjs"), "utf8");
    expect(source).not.toMatch(/modelcontextprotocol|zod/);
  });

  test("the hooks.json invocation, run as Claude Code runs it, blocks with exit 2", () => {
    const hooks = JSON.parse(readFileSync(new URL("../hooks/hooks.json", import.meta.url), "utf8"));
    const { command, args } = hooks.hooks.PreToolUse[0].hooks[0] as { command: string; args: string[] };
    const root = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
    const argv = args.map((a) => a.replace("${CLAUDE_PLUGIN_ROOT}", root));
    const hook = (tool: string) =>
      spawnSync(command === "node" ? process.execPath : command, argv, { input: JSON.stringify({ tool_name: tool }), encoding: "utf8" });
    expect(hook("Bash").status).toBe(2);
    for (const name of TOOL_NAMES.map(qualified)) {
      expect(hook(name).status).toBe(0);
    }
  });
});
