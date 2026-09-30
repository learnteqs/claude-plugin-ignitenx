import { createServer, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { IdentityError, loadConfig } from "../src/identity.js";
import { TMClient, TMError, type TMErrorCode } from "../src/tm-client.js";
import { TEST_KEY, TEST_TOKEN, meFor } from "./fake-tm.js";

const TOKEN_ROUTE = "POST /api/tm/auth/agent-token";
const ME_ROUTE = "GET /api/tenantmanagements/me";
const OPTIONS = "api/tm/provisioning/options";
const REQUESTS = "api/tm/provisioning/requests";
const TM_TEXT = "TM-ERROR-TEXT: the internal reason";

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
type Answer = Reply | "destroy";

// A stand-in TM for the client: numbered tokens, /me from `me`, and scripted answers per route before the defaults.
interface StubTM {
  url: string;
  // "<METHOD> <path> #<token number>", or no number for the exchange.
  seen: string[];
  bodies: string[];
  answers: Map<string, Answer[]>;
  me: unknown;
  close(): Promise<void>;
}

async function startStub(): Promise<StubTM> {
  const issued: string[] = [];
  const stub: StubTM = {
    url: "",
    seen: [],
    bodies: [],
    answers: new Map(),
    me: meFor(["provisioning.submit", "provisioning.view"]),
    close: async () => undefined,
  };
  const fallback = (route: string, token: string | undefined, body: string): Answer => {
    if (route === TOKEN_ROUTE) {
      if ((JSON.parse(body || "{}") as { key?: unknown }).key !== TEST_KEY) {
        return { status: 401, body: "invalid agent key\n" };
      }
      issued.push(`${TEST_TOKEN}-${issued.length + 1}`);
      return { status: 200, body: { access_token: issued.at(-1), token_type: "Bearer", expires_in: 900 } };
    }
    if (token === undefined || !issued.includes(token)) {
      return { status: 401, body: "invalid token\n" };
    }
    return route === ME_ROUTE ? { status: 200, body: stub.me } : { status: 200, body: { ok: true } };
  };
  const server: Server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }
    const route = `${req.method} ${req.url}`;
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    stub.seen.push(token === undefined ? route : `${route} #${issued.indexOf(token) + 1}`);
    stub.bodies.push(body);
    const answer = stub.answers.get(route)?.shift() ?? fallback(route, token, body);
    if (answer === "destroy") {
      req.socket.destroy();
      return;
    }
    const text = typeof answer.body === "string" ? answer.body : answer.body === undefined ? "" : JSON.stringify(answer.body);
    res.writeHead(answer.status, { "Content-Type": "application/json", ...answer.headers }).end(text);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stub.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  stub.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return stub;
}

const tmError = (status: number, code: string, extra: Record<string, unknown> = {}): Reply => ({
  status,
  body: { error: TM_TEXT, code, ...extra },
});

async function expectTMError(promise: Promise<unknown>, code: TMErrorCode): Promise<TMError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(TMError);
  const tmErr = err as TMError;
  expect(tmErr.code).toBe(code);
  for (const secret of [TEST_KEY, TEST_TOKEN, "TM-ERROR-TEXT", "internal reason", "invalid agent key", "invalid token"]) {
    expect(tmErr.message).not.toContain(secret);
  }
  return tmErr;
}

// failOn makes the client's fetch throw `error` for one route and pass everything else to the stub.
const failOn =
  (route: string, error: unknown): typeof fetch =>
  async (input, init) => {
    if (`${init?.method ?? "GET"} ${new URL(String(input)).pathname}` === route) {
      throw error;
    }
    return fetch(input, init);
  };

const timeout = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");
const refused = () => new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });

describe("TMClient", () => {
  let tm: StubTM;
  let now: number;
  const client = (fetchImpl: typeof fetch = fetch) =>
    new TMClient(loadConfig({ TM_BASE_URL: tm.url, TM_AGENT_KEY: TEST_KEY }), fetchImpl, () => now);

  beforeEach(async () => {
    tm = await startStub();
    now = Date.parse("2026-09-29T10:00:00Z");
  });
  afterEach(() => tm.close());

  describe("verification", () => {
    test("checks a new token with /me before the call that needed it, then reuses it", async () => {
      const c = client();
      expect(await c.getJSON(OPTIONS)).toEqual({ ok: true });
      expect(await c.postJSON(REQUESTS, { a: 1 })).toEqual({ status: 200, body: { ok: true } });
      expect(tm.seen).toEqual([
        TOKEN_ROUTE,
        `${ME_ROUTE} #1`,
        `GET /${OPTIONS} #1`,
        `POST /${REQUESTS} #1`,
      ]);
    });

    test.each([
      ["a secret-reading permission", meFor(["provisioning.submit", "db.view"]), "refused"],
      ["a super admin", meFor(["provisioning.view"], { superAdmin: true }), "refused"],
      ["another identity", { ...(meFor(["provisioning.view"]) as object), oid: "key:ffffffffffffffff" }, "refused"],
      ["no permissions", meFor([]), "no_access"],
    ] as const)("refuses %s, and nothing reaches options or requests", async (_name, me, code) => {
      tm.me = me;
      const c = client();
      const get = await expectTMError(c.getJSON(OPTIONS), code);
      const post = await expectTMError(c.postJSON(REQUESTS, { a: 1 }), code);
      expect(get).toBeInstanceOf(IdentityError);
      expect(post).toBeInstanceOf(IdentityError);
      expect(tm.seen.filter((r) => r.includes("/provisioning/"))).toEqual([]);
      expect(tm.seen.filter((r) => r === TOKEN_ROUTE)).toHaveLength(2);
    });

    test("refuses when /me itself is refused, and nothing reaches the target", async () => {
      tm.answers.set(ME_ROUTE, [{ status: 403, body: "insufficient permissions\n" }]);
      await expectTMError(client().postJSON(REQUESTS, { a: 1 }), "no_access");
      expect(tm.seen).toEqual([TOKEN_ROUTE, ME_ROUTE + " #1"]);
    });

    test("re-verifies after TM rejects a verified token: 401, re-exchange, /me, then the call", async () => {
      const c = client();
      await c.getJSON(OPTIONS);
      tm.answers.set(`POST /${REQUESTS}`, [{ status: 401, body: "invalid token\n" }]);
      expect(await c.postJSON(REQUESTS, { n: 1 })).toEqual({ status: 200, body: { ok: true } });
      expect(tm.seen.slice(3)).toEqual([`POST /${REQUESTS} #1`, TOKEN_ROUTE, `${ME_ROUTE} #2`, `POST /${REQUESTS} #2`]);
      expect(tm.bodies.at(-1)).toBe(tm.bodies.at(-4));
    });

    test("stops at /me when the re-exchanged token turns out over-privileged", async () => {
      const c = client();
      await c.identity();
      tm.answers.set(`GET /${OPTIONS}`, [{ status: 401, body: "invalid token\n" }]);
      tm.me = meFor(["provisioning.view", "tenants.delete"]);
      await expectTMError(c.getJSON(OPTIONS), "refused");
      expect(tm.seen).toEqual([TOKEN_ROUTE, `${ME_ROUTE} #1`, `GET /${OPTIONS} #1`, TOKEN_ROUTE, `${ME_ROUTE} #2`]);
    });

    test("verifies again when the token is near expiry", async () => {
      const c = client();
      await c.getJSON(OPTIONS);
      now += 14.5 * 60_000;
      await c.getJSON(OPTIONS);
      expect(tm.seen).toEqual([
        TOKEN_ROUTE,
        `${ME_ROUTE} #1`,
        `GET /${OPTIONS} #1`,
        TOKEN_ROUTE,
        `${ME_ROUTE} #2`,
        `GET /${OPTIONS} #2`,
      ]);
    });

    test("drops a token that a later identity check refuses", async () => {
      const c = client();
      await c.getJSON(OPTIONS);
      tm.me = meFor(["provisioning.view", "db.view"]);
      await expectTMError(c.identity(), "refused");
      await expectTMError(c.getJSON(OPTIONS), "refused");
      expect(tm.seen.filter((r) => r.includes("/provisioning/"))).toHaveLength(1);
    });

    test.each(["https://elsewhere.example/api/x", "//elsewhere.example/api/x", "../api/x"])(
      "never sends a request outside TM_BASE_URL (%s)",
      async (path) => {
        const c = new TMClient(loadConfig({ TM_BASE_URL: `${tm.url}/tenants`, TM_AGENT_KEY: TEST_KEY }));
        await expectTMError(c.getJSON(path), "config");
        await expectTMError(c.postJSON(path, {}), "config");
        expect(tm.seen).toEqual([]);
      },
    );
  });

  describe("error bodies", () => {
    test("keeps only well-formed field errors and never TM's error text", async () => {
      tm.answers.set(`POST /${REQUESTS}`, [
        tmError(422, "invalid_spec", {
          fieldErrors: [
            { path: "fields.planId.value", code: "not_in_options" },
            { path: "fields.title.evidence[0]", code: "quote_not_found", extra: "dropped" },
            { path: "fields.title value", code: "free_text" },
            { path: "fields.<b>", code: "free_text" },
            { path: "f".repeat(61), code: "free_text" },
            { path: "fields.summary", code: "Not_Lower" },
            { path: "fields.summary", code: "x".repeat(41) },
            { path: "flags[2].note", code: "note_required" },
            { path: 7, code: "free_text" },
            "fields.timeZone",
            null,
          ],
        }),
      ]);
      const err = await expectTMError(client().postJSON(REQUESTS, {}), "invalid_spec");
      expect(err.fieldErrors).toEqual([
        { path: "fields.planId.value", code: "not_in_options" },
        { path: "fields.title.evidence[0]", code: "quote_not_found" },
        { path: "flags[2].note", code: "note_required" },
      ]);
      expect(err).toMatchObject({ status: 422, tmCode: "invalid_spec" });
      expect(err.message).toContain("HTTP 422 invalid_spec");
    });

    test("caps field errors at 20", async () => {
      const fieldErrors = Array.from({ length: 25 }, (_, i) => ({ path: `flags[${i}].code`, code: "not_in_options" }));
      tm.answers.set(`POST /${REQUESTS}`, [tmError(422, "invalid_spec", { fieldErrors })]);
      const err = await expectTMError(client().postJSON(REQUESTS, {}), "invalid_spec");
      expect(err.fieldErrors).toEqual(fieldErrors.slice(0, 20));
    });

    test.each([["Invalid-Code"], ["x".repeat(41)], [7], [""]])("drops a malformed TM code (%j)", async (code) => {
      tm.answers.set(`POST /${REQUESTS}`, [{ status: 422, body: { error: TM_TEXT, code } }]);
      const err = await expectTMError(client().postJSON(REQUESTS, {}), "invalid_spec");
      expect(err.tmCode).toBeUndefined();
      expect(err.message).toContain("(HTTP 422)");
    });

    test("ignores a body that is not JSON", async () => {
      tm.answers.set(`GET /${OPTIONS}`, [{ status: 400, body: `${TM_TEXT}\n` }]);
      const err = await expectTMError(client().getJSON(OPTIONS), "bad_request");
      expect(err.tmCode).toBeUndefined();
      expect(err.fieldErrors).toEqual([]);
    });

    test("keeps field errors only on a 422", async () => {
      const fieldErrors = [{ path: "fields.planId", code: "not_in_options" }];
      tm.answers.set(`POST /${REQUESTS}`, [tmError(400, "unknown_field", { fieldErrors })]);
      const err = await expectTMError(client().postJSON(REQUESTS, {}), "bad_request");
      expect(err.fieldErrors).toEqual([]);
    });
  });

  describe("status mapping", () => {
    const answers: [string, Answer, TMErrorCode, number | undefined][] = [
      ["400 malformed_json", tmError(400, "malformed_json"), "bad_request", undefined],
      ["403 agent_key_not_allowed", tmError(403, "agent_key_not_allowed"), "no_access", undefined],
      ["404 not_found", tmError(404, "not_found"), "unavailable", undefined],
      ["409 idempotency_conflict", tmError(409, "idempotency_conflict"), "conflict", undefined],
      ["413 too_large", tmError(413, "too_large"), "too_large", undefined],
      ["422 source_encoding", tmError(422, "source_encoding"), "invalid_spec", undefined],
      ["429 daily_cap", tmError(429, "daily_cap"), "daily_cap", undefined],
      ["429 per-key limit", { status: 429, body: "rate limit exceeded\n", headers: { "Retry-After": "7" } }, "rate_limited", 7],
      ["503 retry_later", { ...tmError(503, "retry_later"), headers: { "Retry-After": "2" } }, "retry_later", 2],
    ];

    test.each(answers)("GET and POST: %s", async (_name, answer, code, wait) => {
      tm.answers.set(`GET /${OPTIONS}`, [answer]);
      tm.answers.set(`POST /${REQUESTS}`, [answer]);
      const c = client();
      // One call at a time: a call started before the loop reaches it could reject with no handler attached yet.
      for (const call of [() => c.getJSON(OPTIONS), () => c.postJSON(REQUESTS, {})]) {
        const err = await expectTMError(call(), code);
        expect(err.status).toBe(typeof answer === "string" ? undefined : answer.status);
        expect(err.retryAfterSeconds).toBe(wait);
        expect(err).not.toBeInstanceOf(IdentityError);
      }
    });

    test("a 401 that survives one re-exchange is rejected", async () => {
      const invalid: Answer = { status: 401, body: "invalid token\n" };
      tm.answers.set(`POST /${REQUESTS}`, [invalid, invalid]);
      await expectTMError(client().postJSON(REQUESTS, {}), "rejected");
      expect(tm.seen.filter((r) => r === TOKEN_ROUTE)).toHaveLength(2);
    });

    test.each([
      ["500 internal", "ambiguous", "unavailable", tmError(500, "internal")],
      ["502 from a proxy", "ambiguous", "unavailable", { status: 502, body: "Bad Gateway" }],
      ["503 without a code", "ambiguous", "unavailable", { status: 503, headers: { "Retry-After": "5" } }],
      ["504 from a proxy", "ambiguous", "unavailable", { status: 504 }],
      ["503 provisioning_unavailable", "unavailable", "unavailable", tmError(503, "provisioning_unavailable")],
      ["503 options_unavailable", "ambiguous", "unavailable", tmError(503, "options_unavailable")],
    ] as [string, TMErrorCode, TMErrorCode, Answer][])("5xx %s: POST %s, GET %s", async (_name, post, get, answer) => {
      tm.answers.set(`POST /${REQUESTS}`, [answer]);
      tm.answers.set(`GET /${OPTIONS}`, [answer]);
      const c = client();
      await expectTMError(c.postJSON(REQUESTS, {}), post);
      await expectTMError(c.getJSON(OPTIONS), get);
    });

    test("keeps Retry-After on an ambiguous 5xx", async () => {
      tm.answers.set(`POST /${REQUESTS}`, [{ status: 503, headers: { "Retry-After": "5" } }]);
      expect((await expectTMError(client().postJSON(REQUESTS, {}), "ambiguous")).retryAfterSeconds).toBe(5);
    });
  });

  describe("lost connections", () => {
    test("a POST cut off after it was sent is ambiguous; a GET is unavailable", async () => {
      tm.answers.set(`POST /${REQUESTS}`, ["destroy"]);
      tm.answers.set(`GET /${OPTIONS}`, ["destroy"]);
      const c = client();
      await expectTMError(c.postJSON(REQUESTS, { a: 1 }), "ambiguous");
      await expectTMError(c.getJSON(OPTIONS), "unavailable");
      expect(tm.bodies[tm.seen.indexOf(`POST /${REQUESTS} #1`)]).toBe('{"a":1}');
    });

    test("a POST that timed out is ambiguous; a GET is unavailable", async () => {
      const post = await expectTMError(client(failOn(`POST /${REQUESTS}`, timeout())).postJSON(REQUESTS, {}), "ambiguous");
      expect(post.message).toContain("did not answer in time");
      await expectTMError(client(failOn(`GET /${OPTIONS}`, timeout())).getJSON(OPTIONS), "unavailable");
    });

    test("a POST whose connection was refused never reached TM, so it is unavailable", async () => {
      await expectTMError(client(failOn(`POST /${REQUESTS}`, refused())).postJSON(REQUESTS, {}), "unavailable");
    });

    test("a 2xx answer to a POST that cannot be read is ambiguous", async () => {
      tm.answers.set(`POST /${REQUESTS}`, [{ status: 201, body: "{not json" }]);
      await expectTMError(client().postJSON(REQUESTS, {}), "ambiguous");
      tm.answers.set(`GET /${OPTIONS}`, [{ status: 200, body: "{not json" }]);
      await expectTMError(client().getJSON(OPTIONS), "unavailable");
    });

    test.each([
      ["the exchange answers 500", TOKEN_ROUTE, { status: 500, body: "could not issue token\n" }],
      ["the exchange is cut off", TOKEN_ROUTE, "destroy"],
      ["/me answers 502", ME_ROUTE, { status: 502 }],
      ["/me is cut off", ME_ROUTE, "destroy"],
    ] as [string, string, Answer][])("a POST is never ambiguous when %s", async (_name, route, answer) => {
      tm.answers.set(route, [answer]);
      const err = await expectTMError(client().postJSON(REQUESTS, {}), "unavailable");
      expect(err).toBeInstanceOf(IdentityError);
      expect(tm.seen.filter((r) => r.includes("/provisioning/"))).toEqual([]);
    });

    test.each([
      ["the exchange times out", TOKEN_ROUTE],
      ["/me times out", ME_ROUTE],
    ])("a POST is never ambiguous when %s", async (_name, route) => {
      await expectTMError(client(failOn(route, timeout())).postJSON(REQUESTS, {}), "unavailable");
      expect(tm.seen.filter((r) => r.includes("/provisioning/"))).toEqual([]);
    });
  });

  test("posts JSON with the token only in the Authorization header, and returns TM's status and body", async () => {
    tm.answers.set(`POST /${REQUESTS}`, [{ status: 201, body: { id: "pr-1", replayed: false } }]);
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const c = client(async (input, init) => {
      seen.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
      return fetch(input, init);
    });
    expect(await c.postJSON(REQUESTS, { b: [1, "x"] })).toEqual({ status: 201, body: { id: "pr-1", replayed: false } });
    const post = seen.at(-1);
    expect(post?.url).toBe(`${tm.url}/${REQUESTS}`);
    expect(post?.headers).toEqual({ Authorization: `Bearer ${TEST_TOKEN}-1`, "Content-Type": "application/json" });
    expect(tm.bodies.at(-1)).toBe('{"b":[1,"x"]}');
  });
});
