// The tool names live in five places and the version in six; this keeps each one value, so no layer allows a tool
// another doesn't know and no file names another release.
import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "vitest";

import { ALLOWED_TOOLS } from "../src/guard.js";
import { SERVER_VERSION, createServer } from "../src/server.js";
import { SERVER_PREFIX, TOOL_NAMES, qualified } from "../src/tool-names.js";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const json = (path: string) => JSON.parse(read(path)) as Record<string, unknown>;
const expected = TOOL_NAMES.map(qualified);

async function registered(): Promise<string[]> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({}).connect(serverSide);
  const client = new Client({ name: "sync-test", version: "0" });
  await client.connect(clientSide);
  try {
    return (await client.listTools()).tools.map((t) => t.name);
  } finally {
    await client.close();
  }
}

// allowedTools reads a comma-separated list of tool names, rejecting blanks and spaces around commas.
function list(value: string | undefined): string[] {
  const names = (value ?? "").split(",");
  expect(names.every((n) => /^\S+$/.test(n))).toBe(true);
  return names;
}

describe("tool names stay in sync", () => {
  test("the server registers exactly TOOL_NAMES, in order", async () => {
    expect(await registered()).toEqual([...TOOL_NAMES]);
  });

  test("the guard allows exactly the qualified names", () => {
    expect([...ALLOWED_TOOLS].sort()).toEqual([...expected].sort());
    expect(expected.every((n) => n.startsWith(SERVER_PREFIX))).toBe(true);
  });

  test("the server's qualified name matches .mcp.json and the plugin name", () => {
    const plugin = json(".claude-plugin/plugin.json") as { name: string };
    const server = Object.keys((json(".mcp.json") as { mcpServers: object }).mcpServers)[0];
    expect(SERVER_PREFIX).toBe(`mcp__plugin_${plugin.name}_${server}__`);
  });

  // A command's allowed-tools skips the desktop's Manual confirmation, so /poll must never pre-approve a submit.
  test("commands/poll.md allows the qualified names except tpa_submit_request", () => {
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read("commands/poll.md"))?.[1] ?? "";
    const lines = front.split(/\r?\n/).filter((l) => l.startsWith("allowed-tools:"));
    expect(lines).toHaveLength(1);
    const allowed = list(lines[0]?.slice("allowed-tools:".length).trim());
    expect(allowed).toEqual(TOOL_NAMES.filter((n) => n !== "tpa_submit_request").map(qualified));
    expect(allowed).not.toContain(qualified("tpa_submit_request"));
  });

  test("USAGE.md's --allowedTools lists exactly the qualified names", () => {
    const uses = [...read("USAGE.md").matchAll(/--allowedTools\s+(\S+)/g)];
    expect(uses).toHaveLength(1);
    expect(list(uses[0]?.[1])).toEqual(expected);
  });
});

describe("the version stays in sync", () => {
  const version = (json("package.json") as { version: string }).version;

  test("package.json holds a release version", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("the server, plugin.json and package-lock.json name package.json's version", () => {
    expect(SERVER_VERSION).toBe(version);
    expect(json(".claude-plugin/plugin.json").version).toBe(version);
    const lock = json("package-lock.json") as { version: unknown; packages: Record<string, { version?: unknown }> };
    expect(lock.version).toBe(version);
    expect(lock.packages[""]?.version).toBe(version);
  });

  test("the marketplace entry for ignitenx-tm names package.json's version", () => {
    const plugin = json(".claude-plugin/plugin.json") as { name: string };
    const { plugins } = json("../../.claude-plugin/marketplace.json") as { plugins: { name: string; version?: unknown }[] };
    const entries = plugins.filter((p) => p.name === plugin.name);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.version).toBe(version);
  });
});
