import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { IdentityError, TMClient, checkIdentity, loadConfig } from "../src/identity.js";
import { TEST_KEY, TEST_KEY_ID, TEST_TOKEN, meFor, startFakeTM, type FakeTM } from "./fake-tm.js";

const expectCode = async (promise: Promise<unknown>, code: string) => {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(IdentityError);
  expect((err as IdentityError).code).toBe(code);
  expect(String((err as Error).message)).not.toContain(TEST_KEY);
  expect(String((err as Error).message)).not.toContain(TEST_TOKEN);
  return err as IdentityError;
};

describe("loadConfig", () => {
  test("accepts an https URL and a well-formed key, and parses the key id", () => {
    const config = loadConfig({ TM_BASE_URL: "https://tm.example.com/tenants", TM_AGENT_KEY: ` ${TEST_KEY} ` });
    expect(config.keyId).toBe(TEST_KEY_ID);
    expect(config.baseUrl.href).toBe("https://tm.example.com/tenants/");
  });

  test.each([
    [{ TM_AGENT_KEY: TEST_KEY }, "TM_BASE_URL is not set"],
    [{ TM_BASE_URL: "http://tm.example.com", TM_AGENT_KEY: TEST_KEY }, "must use https"],
    [{ TM_BASE_URL: "https://user:pw@tm.example.com", TM_AGENT_KEY: TEST_KEY }, "must not carry credentials"],
    [{ TM_BASE_URL: "https://tm.example.com" }, "TM_AGENT_KEY"],
    [{ TM_BASE_URL: "https://tm.example.com", TM_AGENT_KEY: "inx_acme_1_abc" }, "TM_AGENT_KEY"],
    [{ TM_BASE_URL: "https://tm.example.com?x=1", TM_AGENT_KEY: TEST_KEY }, "must not carry"],
    [{ TM_BASE_URL: "https://tm.example.com/#f", TM_AGENT_KEY: TEST_KEY }, "must not carry"],
    [{ TM_BASE_URL: "https://tm.example.com", TM_AGENT_KEY: TEST_KEY, NODE_TLS_REJECT_UNAUTHORIZED: "0" }, "certificate"],
    [{ TM_BASE_URL: "https://tm.example.com", TM_AGENT_KEY_FILE: "/no/such/key/file" }, "could not be read"],
  ])("refuses %j", (env, message) => {
    expect(() => loadConfig(env)).toThrowError(message);
  });

  test("reads the key from TM_AGENT_KEY_FILE in preference to the environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "tpa-key-"));
    try {
      writeFileSync(join(dir, "key"), `${TEST_KEY}\n`);
      const config = loadConfig({ TM_BASE_URL: "https://tm.example.com", TM_AGENT_KEY: "wrong", TM_AGENT_KEY_FILE: join(dir, "key") });
      expect(config.key).toBe(TEST_KEY);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("allows plain http only for localhost", () => {
    expect(loadConfig({ TM_BASE_URL: "http://localhost:8100", TM_AGENT_KEY: TEST_KEY }).baseUrl.port).toBe("8100");
  });
});

describe("checkIdentity", () => {
  test("returns the key's identity when it holds only allowed permissions", () => {
    const identity = checkIdentity(meFor(["plans.view", "partners.view"]), TEST_KEY_ID, "2026-09-27T10:00:00.000Z");
    expect(identity).toEqual({
      keyId: TEST_KEY_ID,
      keyName: "provisioning-agent",
      permissions: ["partners.view", "plans.view"],
      grants: [
        { permissions: ["plans.view", "partners.view"], scope: { allTenants: true, tenants: [], partners: [] } },
      ],
      tokenExpiresAt: "2026-09-27T10:00:00.000Z",
    });
  });

  test.each([
    ["another identity", { ...(meFor(["plans.view"]) as object), email: "someone@learnteq.com" }, "someone other"],
    ["a mismatched oid only", { ...(meFor(["plans.view"]) as object), oid: "key:ffffffffffffffff" }, "someone other"],
    ["a super admin", meFor(["plans.view"], { superAdmin: true }), "super-admin"],
    ["no superAdmin field", meFor(["plans.view"], { superAdmin: undefined }), "super-admin"],
    ["a secret-reading permission", meFor(["plans.view", "db.view"]), "db.view"],
    ["access-control visibility", meFor(["plans.view", "accesscontrol.view"]), "accesscontrol.view"],
  ])("refuses %s", (_name, me, message) => {
    expect(() => checkIdentity(me, TEST_KEY_ID, "")).toThrowError(message);
  });

  test("refuses a permission that appears only inside one grant", () => {
    const me = meFor(["plans.view"]) as { access: { grants: unknown[] } };
    me.access.grants.push({ permissions: ["tenants.create"], scope: { allTenants: false, tenants: ["acme"] } });
    expect(() => checkIdentity(me, TEST_KEY_ID, "")).toThrowError("tenants.create");
  });

  test("refuses a permission that appears only in the combined list", () => {
    const me = meFor(["plans.view"]) as { access: { permissions: string[] } };
    me.access.permissions = ["plans.view", "audit.view"];
    expect(() => checkIdentity(me, TEST_KEY_ID, "")).toThrowError("audit.view");
  });

  test("refuses a key with no permissions at all", () => {
    expect(() => checkIdentity(meFor([]), TEST_KEY_ID, "")).toThrowError("no permissions");
  });
});

describe("TMClient", () => {
  let tm: FakeTM;
  let now: number;
  const client = () =>
    new TMClient(loadConfig({ TM_BASE_URL: tm.url, TM_AGENT_KEY: TEST_KEY }), fetch, () => now);

  beforeEach(async () => {
    tm = await startFakeTM();
    now = Date.parse("2026-09-27T10:00:00Z");
  });
  afterEach(() => tm.close());

  test("exchanges the key once, sends the token only as a Bearer header, and reuses it until near expiry", async () => {
    const c = client();
    const identity = await c.identity();
    expect(identity.permissions).toEqual(["partners.view", "plans.view"]);
    expect(identity.tokenExpiresAt).toBe("2026-09-27T10:15:00.000Z");
    expect(JSON.stringify(identity)).not.toContain(TEST_TOKEN);

    await c.identity();
    expect(tm.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /api/tm/auth/agent-token",
      "GET /api/tenantmanagements/me",
      "GET /api/tenantmanagements/me",
    ]);
    expect(tm.requests[0]?.body).toBe(JSON.stringify({ key: TEST_KEY }));
    expect(tm.requests.every((r) => !r.path.includes("token=") && !r.path.includes(TEST_KEY))).toBe(true);

    now += 14.5 * 60_000;
    await c.identity();
    expect(tm.requests.filter((r) => r.path === "/api/tm/auth/agent-token")).toHaveLength(2);
  });

  test("keeps a path prefix such as /tenants in every request", async () => {
    const seen: string[] = [];
    const prefixed = new TMClient(loadConfig({ TM_BASE_URL: `${tm.url}/tenants`, TM_AGENT_KEY: TEST_KEY }), (input, init) => {
      const url = new URL(String(input));
      seen.push(url.pathname);
      url.pathname = url.pathname.replace(/^\/tenants/, "");
      return fetch(url, init);
    });
    await prefixed.identity();
    expect(seen).toEqual(["/tenants/api/tm/auth/agent-token", "/tenants/api/tenantmanagements/me"]);
  });

  test("re-exchanges the key once when a cached token is rejected", async () => {
    const c = client();
    await c.identity();
    let rejected = false;
    const flaky = new TMClient(loadConfig({ TM_BASE_URL: tm.url, TM_AGENT_KEY: TEST_KEY }), async (input, init) => {
      if (String(input).endsWith("/me") && !rejected) {
        rejected = true;
        return new Response("invalid token\n", { status: 401 });
      }
      return fetch(input, init);
    });
    expect((await flaky.identity()).keyId).toBe(TEST_KEY_ID);
    expect(tm.requests.filter((r) => r.path === "/api/tm/auth/agent-token")).toHaveLength(3);
  });

  test("never follows a redirect, so the key is not re-sent to another origin", async () => {
    const other: string[] = [];
    const elsewhere = createServer((req, res) => {
      other.push(`${req.method} ${req.url}`);
      res.writeHead(200).end("{}");
    });
    await new Promise<void>((resolve) => elsewhere.listen(0, "127.0.0.1", resolve));
    const address = elsewhere.address() as { port: number };
    const redirecting = createServer((_req, res) => {
      res.writeHead(307, { Location: `http://127.0.0.1:${address.port}/api/tm/auth/agent-token` }).end();
    });
    await new Promise<void>((resolve) => redirecting.listen(0, "localhost", resolve));
    try {
      const port = (redirecting.address() as { port: number }).port;
      const c = new TMClient(loadConfig({ TM_BASE_URL: `http://localhost:${port}`, TM_AGENT_KEY: TEST_KEY }));
      await expectCode(c.identity(), "unavailable");
      expect(other).toEqual([]);
    } finally {
      await new Promise((resolve) => elsewhere.close(resolve));
      await new Promise((resolve) => redirecting.close(resolve));
    }
  });

  test("maps Tenant Manager refusals to codes without echoing secrets", async () => {
    tm.exchangeStatus = 401;
    const rejected = await expectCode(client().identity(), "rejected");
    expect(rejected.message).toContain('HTTP 401 "invalid agent key"');
    tm.exchangeStatus = 429;
    const limited = await expectCode(client().identity(), "rate_limited");
    expect(limited.message).toContain("retry after 7s");
    tm.exchangeStatus = 503;
    await expectCode(client().identity(), "unavailable");
    tm.exchangeStatus = 200;
    tm.meStatus = 403;
    await expectCode(client().identity(), "no_access");
  });

  test("refuses over-privileged access reported by /me", async () => {
    tm.me = meFor(["plans.view", "tenants.delete"]);
    const err = await expectCode(client().identity(), "refused");
    expect(err.message).toContain("tenants.delete");
  });

  test("reports an unreachable Tenant Manager without the key", async () => {
    const url = tm.url;
    await tm.close();
    const c = new TMClient(loadConfig({ TM_BASE_URL: url, TM_AGENT_KEY: TEST_KEY }));
    await expectCode(c.identity(), "unavailable");
    tm = await startFakeTM();
  });
});
