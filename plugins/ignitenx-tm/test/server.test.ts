// The server as the model sees it, over an in-memory MCP connection, against the stand-in TM.
import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { getInstructions } from "../src/instructions.js";
import { mapOptions } from "../src/options.js";
import { SERVER_VERSION, createServer } from "../src/server.js";
import { FLAG_CODES, STAGES } from "../src/spec.js";
import { containsSecret } from "../src/text.js";
import { TOOL_NAMES } from "../src/tool-names.js";
import {
  AGENT_PERMISSIONS,
  CANARIES,
  OPTIONS_VERSION,
  TEST_KEY,
  TEST_TOKEN,
  meFor,
  requestInput,
  startFakeTM,
  tmOptions,
  type FakeTM,
} from "./fake-tm.js";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const UI_URL = "http://localhost:5173";
// Secret shapes that are not the test key or token, so only the scrubber or a fixed message can keep them out.
const AWS_KEY = "AKIAQ3EXAMPLEKEY7890";
const OTHER_KEY = `tmk_${"f".repeat(16)}_${"S".repeat(43)}`;
const BODY_KEYS = [
  "clientRequestId",
  "schemaVersion",
  "clientOptionsVersion",
  "client",
  "sourceText",
  "summary",
  "triage",
  "fields",
  "flags",
];

interface Result {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

const text = (r: Result) => r.content.map((c) => c.text).join("\n");
const paths = (tm: FakeTM) => tm.requests.map((r) => `${r.method} ${r.path}`);

// input is requestInput() with the values at the given dotted paths replaced.
function input(set: Record<string, unknown> = {}): Record<string, unknown> {
  const out = requestInput();
  for (const [path, value] of Object.entries(set)) {
    const keys = path.split(".");
    const leaf = keys.pop() ?? "";
    let node = out;
    for (const key of keys) {
      node = node[key] as Record<string, unknown>;
    }
    node[leaf] = value;
  }
  return out;
}

describe("tpa-mcp server", () => {
  let tm: FakeTM;
  let client: Client;
  let seen: Result[];

  const open = async (
    env: NodeJS.ProcessEnv = { TM_BASE_URL: tm.url, TM_AGENT_KEY: TEST_KEY, TM_UI_URL: UI_URL },
    fetchImpl: typeof fetch = fetch,
  ) => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer(env, fetchImpl).connect(serverSide);
    const c = new Client({ name: "server-test", version: "0" });
    await c.connect(clientSide);
    return c;
  };
  const call = async (name: string, args: Record<string, unknown> = {}, on: Client = client) => {
    const result = (await on.callTool({ name, arguments: args })) as Result;
    seen.push(result);
    return result;
  };

  beforeEach(async () => {
    tm = await startFakeTM();
    tm.me = meFor(AGENT_PERMISSIONS);
    seen = [];
    client = await open();
  });

  afterEach(async () => {
    const everything = JSON.stringify(seen);
    for (const secret of [TEST_KEY, TEST_TOKEN, ...CANARIES]) {
      expect(everything).not.toContain(secret);
    }
    await client.close();
    await tm.close();
  });

  test("offers exactly the three tools, in order, with the instructions and version", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    const [identity, options, submit] = tools;
    expect(identity?.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
    expect(options?.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
    expect(options?.inputSchema).toMatchObject({ type: "object", properties: {}, additionalProperties: false });
    expect(submit?.annotations).toEqual({ idempotentHint: true, destructiveHint: false, openWorldHint: true });
    expect(submit?.inputSchema).toMatchObject({
      type: "object",
      required: ["sourceText", "summary", "triage", "fields", "flags"],
      additionalProperties: false,
    });
    expect(client.getInstructions()).toBe(getInstructions());
    expect(client.getServerVersion()).toMatchObject({ name: "tpa-mcp", version: SERVER_VERSION });
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(SERVER_VERSION).toBe(pkg.version);
  });

  test("the submit description carries the stage and placement rules in 1,500 characters", async () => {
    const { tools } = await client.listTools();
    const description = tools.find((t) => t.name === "tpa_submit_request")?.description ?? "";
    expect(description.length).toBeLessThanOrEqual(1500);
    expect(description).toMatch(/^[\x20-\x7e]+$/);
    for (const rule of [
      "request_ready when the thread settles a request",
      "under_discussion while it is still being discussed",
      "not_a_request exactly when isTenantRequest is false",
      "the placementPreview suggestion for that kind, as chosen",
      "the field is absent and you flag placement_needs_human",
      "only in the note of a placement_requested_in_text flag",
      "goes in requestedEnvironment or requestedRegion, which never decide placement",
      "resend the same input unchanged or start a new session",
    ]) {
      expect(description).toContain(rule);
    }
    const known = new Set<string>([
      ...TOOL_NAMES,
      ...FLAG_CODES,
      ...STAGES,
      "invalid_spec",
      "ambiguous",
      "retry_later",
      "submit_pending",
    ]);
    expect((description.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []).filter((c) => !known.has(c))).toEqual([]);
  });

  test("identity, options, then submit records the request once and returns only the allowed fields", async () => {
    const identity = await call("tpa_get_identity");
    expect(identity.isError).toBeFalsy();
    expect(identity.structuredContent).toMatchObject({ keyName: "provisioning-agent", permissions: AGENT_PERMISSIONS });

    const options = await call("tpa_get_options");
    expect(options.isError).toBeFalsy();
    expect(options.structuredContent).toEqual(mapOptions(tmOptions()).agent);
    expect(JSON.parse(text(options))).toEqual(options.structuredContent);

    const submitted = await call("tpa_submit_request", input());
    expect(submitted.isError, text(submitted)).toBeFalsy();
    const result = submitted.structuredContent as Record<string, unknown> & { requestId: string };
    expect(Object.keys(result)).toEqual([
      "requestId",
      "mode",
      "status",
      "readiness",
      "replayed",
      "checks",
      "redactions",
      "hiddenCharacters",
      "reviewUrl",
    ]);
    expect(result).toMatchObject({ mode: "shadow", status: "recorded", readiness: "complete", replayed: false });
    expect(result.checks).toEqual([
      { code: "tenant_key_available", result: "pass" },
      { code: "company_id_available", result: "unknown", severity: "warning", reason: "lookup_failed" },
      { code: "secret_scan", result: "fail", severity: "warning", count: 1 },
    ]);
    expect(result.reviewUrl).toBe(`${UI_URL}/provisioning/requests/${result.requestId}`);

    expect(tm.submissions).toHaveLength(1);
    const body = JSON.parse(tm.submissions[0] ?? "{}") as Record<string, unknown> & { clientRequestId: string };
    expect(Object.keys(body)).toEqual(BODY_KEYS);
    expect(body.clientRequestId).toMatch(ULID);
    expect(result.requestId).toBe(`pr-${body.clientRequestId}`);
    expect(body).toMatchObject({
      schemaVersion: 1,
      clientOptionsVersion: OPTIONS_VERSION,
      client: { name: "tpa-mcp", version: SERVER_VERSION },
    });
    expect(paths(tm)).toEqual([
      "POST /api/tm/auth/agent-token",
      "GET /api/tenantmanagements/me",
      "GET /api/tm/provisioning/options",
      "POST /api/tm/provisioning/requests",
    ]);

    const again = await call("tpa_submit_request", input());
    expect(again.isError).toBe(true);
    expect(text(again)).toBe("Submit failed (already_submitted: start a new session for the next request).");
    expect(tm.submissions).toHaveLength(1);
  });

  test("options verify the key first even when the model skips the identity tool", async () => {
    const options = await call("tpa_get_options");
    expect(options.isError).toBeFalsy();
    expect(paths(tm)).toEqual([
      "POST /api/tm/auth/agent-token",
      "GET /api/tenantmanagements/me",
      "GET /api/tm/provisioning/options",
    ]);
  });

  test("a submit before the options is refused with options_required and sends nothing", async () => {
    const result = await call("tpa_submit_request", input());
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Submit failed \(options_required: call tpa_get_options first/);
    expect(tm.requests).toEqual([]);
  });

  test("a spec the plugin refuses lists each field as path: code and sends nothing", async () => {
    await call("tpa_get_options");
    const result = await call(
      "tpa_submit_request",
      input({
        "fields.subscription.planId.value": "plan-gold",
        "fields.placement.postgresServerId.value": "pg-prod-2",
        summary: "See https://example.com/brief",
      }),
    );
    expect(result.isError).toBe(true);
    expect(text(result).split("\n")).toEqual([
      "Submit failed (invalid_spec: the spec has invalid fields; fix only those fields and submit again).",
      "summary: free_text",
      "fields.subscription.planId.value: not_in_options",
      "fields.placement.postgresServerId.value: unknown_server",
    ]);
    expect(tm.submissions).toEqual([]);
  });

  test("TM's field errors reach the model as path: code lines, TM's text never does, and a fix may follow", async () => {
    await call("tpa_get_options");
    tm.submitReplies = [
      {
        status: 422,
        body: {
          error: "the provisioning request is not valid (CANARY-ERR)",
          code: "invalid_spec",
          fieldErrors: [
            { path: "fields.tenantKey.value", code: "reserved_name" },
            { path: "fields.adminEmail.value", code: "invalid_format" },
            { path: "fields.title.value", code: "Not A Code (CANARY-ERR)" },
          ],
        },
      },
    ];
    const rejected = await call("tpa_submit_request", input());
    expect(rejected.isError).toBe(true);
    expect(text(rejected).split("\n")).toEqual([
      "Submit failed (invalid_spec: Tenant Manager refused the request (HTTP 422 invalid_spec): the request has " +
        "invalid fields).",
      "fields.tenantKey.value: reserved_name",
      "fields.adminEmail.value: invalid_format",
    ]);

    const fixed = await call("tpa_submit_request", input({ "fields.tenantKey.value": "acme-learning-in" }));
    expect(fixed.isError, text(fixed)).toBeFalsy();
    const ids = tm.submissions.map((b) => (JSON.parse(b) as { clientRequestId: string }).clientRequestId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });

  test("a schema violation is refused before the handler and sends nothing", async () => {
    await call("tpa_get_options");
    const result = await call("tpa_submit_request", { ...input(), approved: true });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("approved");
    expect(tm.submissions).toEqual([]);
  });

  test("an over-privileged key is refused by options and submit, and nothing reaches their routes", async () => {
    tm.me = meFor(["provisioning.submit", "db.view"]);
    const options = await call("tpa_get_options");
    expect(options.isError).toBe(true);
    expect(text(options)).toMatch(/^Reading the options failed \(refused: .*db\.view\)\. Stop\.$/);
    const submit = await call("tpa_submit_request", input());
    expect(submit.isError).toBe(true);
    expect(text(submit)).toContain("options_required");
    expect(paths(tm)).toEqual(["POST /api/tm/auth/agent-token", "GET /api/tenantmanagements/me"]);
  });

  test("a refused key's message names no unrecognised permission and holds no secret shape", async () => {
    tm.me = meFor(["provisioning.submit", "db.view", "password=hunter22xyz"]);
    const options = await call("tpa_get_options");
    expect(options.isError).toBe(true);
    const said = text(options);
    expect(said).toMatch(/^Reading the options failed \(refused: .*: db\.view and 1 unrecognised permission\)\. Stop\.$/);
    expect(said).not.toContain("password");
    expect(said).not.toContain("hunter22xyz");
    expect(containsSecret(said)).toBe(false);
  });

  test("an error message is scrubbed on its way out", async () => {
    await call("tpa_get_options");
    tm.submitReplies = [
      {
        status: 422,
        body: { code: "invalid_spec", fieldErrors: [{ path: `fields.${AWS_KEY}`, code: "invalid_format" }] },
      },
    ];
    const rejected = await call("tpa_submit_request", input());
    expect(rejected.isError).toBe(true);
    expect(text(rejected).split("\n")).toEqual([
      "Submit failed (invalid_spec: Tenant Manager refused the request (HTTP 422 invalid_spec): the request has " +
        "invalid fields).",
      "fields.[redacted]: invalid_format",
    ]);
    expect(JSON.stringify(seen)).not.toContain(AWS_KEY);
  });

  test("an error from neither Tenant Manager nor the submit is reported as unexpected, without its text", async () => {
    const throwing: typeof fetch = async (url, init) => {
      const res = await fetch(url, init);
      if (new URL(String(url)).pathname === "/api/tm/provisioning/options") {
        Object.defineProperty(res, "ok", {
          get: () => {
            throw new Error(`${OTHER_KEY} is the secret`);
          },
        });
      }
      return res;
    };
    const broken = await open(undefined, throwing);
    try {
      const options = await call("tpa_get_options", {}, broken);
      expect(options.isError).toBe(true);
      expect(text(options)).toBe("Reading the options failed (unavailable: unexpected error). Stop.");
      expect(JSON.stringify(seen)).not.toContain(OTHER_KEY);
    } finally {
      await broken.close();
    }
  });

  test("a new token is verified before a submit, so a key that gained access sends nothing", async () => {
    tm.expiresIn = 60;
    expect((await call("tpa_get_options")).isError).toBeFalsy();
    tm.me = meFor([...AGENT_PERMISSIONS, "db.view"]);
    const submit = await call("tpa_submit_request", input());
    expect(submit.isError).toBe(true);
    expect(text(submit)).toMatch(/^Submit failed \(refused: .*db\.view\)\.$/);
    expect(tm.requests.filter((r) => r.path === "/api/tm/provisioning/requests")).toEqual([]);
    expect(tm.requests.filter((r) => r.path === "/api/tenantmanagements/me")).toHaveLength(2);
  });

  test("the key and token are scrubbed even from values TM echoes back", async () => {
    tm.options = {
      ...tmOptions(),
      partners: [{ id: "P-102", name: TEST_TOKEN }],
      plans: [{ id: "plan-std", name: `Standard ${TEST_KEY}`, type: "Password: CANARY-PW-1", hasGenAI: true }],
    };
    const options = await call("tpa_get_options");
    expect(options.isError).toBeFalsy();
    const agent = options.structuredContent as { partners: unknown[]; plans: unknown[] };
    expect(agent.partners).toEqual([{ id: "P-102", name: "[redacted]" }]);
    expect(agent.plans).toEqual([{ id: "plan-std", name: "Standard [redacted]", type: "Password: [redacted]", hasGenAI: true }]);
  });

  test("TM's error text never reaches the model", async () => {
    tm.optionsStatus = 503;
    const options = await call("tpa_get_options");
    expect(options.isError).toBe(true);
    expect(text(options)).toBe(
      "Reading the options failed (unavailable: Tenant Manager refused the request (HTTP 503 options_unavailable): " +
        "Tenant Manager is unavailable). Stop.",
    );
  });

  test("without configuration every tool fails with config and nothing is sent", async () => {
    const bare = await open({ TM_BASE_URL: tm.url });
    try {
      for (const [name, args] of [
        ["tpa_get_identity", {}],
        ["tpa_get_options", {}],
        ["tpa_submit_request", input()],
      ] as const) {
        const result = await call(name, args, bare);
        expect(result.isError).toBe(true);
        expect(text(result)).toContain("config: TM_AGENT_KEY");
      }
      expect(tm.requests).toEqual([]);
    } finally {
      await bare.close();
    }
  });
});
