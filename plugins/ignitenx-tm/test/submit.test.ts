import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, test, vi } from "vitest";

import { mapOptions, type CachedOptions } from "../src/options.js";
import { SECRET_KINDS, SubmitInputSchema, type SubmitInput } from "../src/spec.js";
import { SubmitError, Submitter, type SubmitterDeps } from "../src/submit.js";
import { normalizeText, redact, redactRaw } from "../src/text.js";
import { TMError } from "../src/tm-client.js";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});

const CONTRACT = JSON.parse(readFileSync(new URL("./fixtures/request-v1.json", import.meta.url), "utf8")) as Record<
  string,
  unknown
>;
const SOURCE = CONTRACT.sourceText as string;
const T0 = Date.UTC(2026, 8, 29, 10, 0, 0);
const MINUTE = 60_000;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const TMK = `tmk_0123456789abcdef_${"Abc-_123".repeat(5)}xyz`;

function options(): CachedOptions {
  const server = (id: string) => ({ id, name: id, environmentMatch: true });
  return mapOptions({
    schemaVersion: 1,
    optionsVersion: CONTRACT.clientOptionsVersion,
    environment: { name: "development", configured: true },
    partnerRequired: true,
    partners: [{ id: "P-102", name: "Repute" }],
    plans: [{ id: "plan-std", name: "Standard", type: "standard", hasGenAI: false }],
    languages: ["en", "ta"].map((code) => ({ code, label: code })),
    themes: ["default", "Doom 64"],
    themeModes: ["light", "dark", "system"],
    subscriptionStatuses: ["active", "inactive"],
    preferredProviders: ["openai", "anthropic"],
    defaults: {
      defaultLang: "en",
      theme: "default",
      themeMode: "light",
      subscriptionStatus: "active",
      preferredProvider: "openai",
      optionFlags: false,
    },
    servers: {
      postgres: [server("local-pg"), server("pg-b")],
      mongo: [server("local-mongo")],
      blob: [server("blob-1")],
    },
    placementPreview: {
      postgresServerId: { suggested: "local-pg", basis: "fewest_tenants" },
      mongoServerId: { suggested: "local-mongo", basis: "only_candidate" },
      blobAccountId: { suggested: "blob-1", basis: "only_candidate" },
    },
    limits: {
      sourceTextMaxChars: 50000,
      quoteMaxChars: 300,
      quotesPerField: 3,
      flagsMax: 20,
      noteMaxChars: 200,
      tenantKey: { min: 3, max: 52 },
    },
  });
}

function input(set: Record<string, unknown> = {}): SubmitInput {
  const { clientRequestId, schemaVersion, clientOptionsVersion, client, ...rest } = structuredClone(CONTRACT);
  const m = rest as Record<string, unknown>;
  for (const [path, value] of Object.entries(set)) {
    const keys = path.split(".");
    const leaf = keys.pop() ?? "";
    let node = m;
    for (const key of keys) {
      node = node[key] as Record<string, unknown>;
    }
    node[leaf] = value;
  }
  return SubmitInputSchema.parse(m);
}

// tmAnswer is shaped like TM's provisioningSubmitResponse.
function tmAnswer(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `pr-${id}`,
    mode: "shadow",
    status: "recorded",
    readiness: "complete",
    replayed: false,
    specHash: `sha256:${"ab".repeat(32)}`,
    pagePath: `/provisioning/requests/pr-${id}`,
    checks: [
      { code: "tenant_key_available", result: "pass" },
      { code: "company_id_available", result: "unknown", severity: "warning", count: 1 },
      { code: "required_fields_present", result: "fail", severity: "blocker", fields: ["fields.timeZone"] },
    ],
    redactions: [{ code: "password_line", count: 1 }],
    ...extra,
  };
}

type Answer = { status: number; body: unknown } | Error | ((id: string) => { status: number; body: unknown });

function harness(answers: Answer[] = [], deps: Partial<SubmitterDeps> = {}) {
  const bodies: string[] = [];
  const postJSON = vi.fn(async (path: string, body: unknown) => {
    expect(path).toBe("api/tm/provisioning/requests");
    bodies.push(JSON.stringify(body));
    const id = (body as { clientRequestId: string }).clientRequestId;
    const next = answers.shift() ?? { status: 201, body: tmAnswer(id) };
    if (next instanceof Error) {
      throw next;
    }
    return typeof next === "function" ? next(id) : next;
  });
  let now = T0;
  let seed = 0;
  const submitter = new Submitter({
    client: { postJSON },
    options: { current: () => options() },
    env: {},
    now: () => now,
    random: (n) => Buffer.alloc(n, seed++),
    version: "0.2.0",
    ...deps,
  });
  return {
    submitter,
    postJSON,
    bodies,
    sent: () => bodies.map((b) => JSON.parse(b) as Record<string, unknown> & { clientRequestId: string }),
    advance: (ms: number) => (now += ms),
  };
}

function settle<T>(p: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  return p.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
}

const ulidTime = (id: string) => [...id.slice(0, 10)].reduce((ms, c) => ms * 32 + CROCKFORD.indexOf(c), 0);
const invalid = (...fieldErrors: { path: string; code: string }[]) =>
  new TMError("invalid_spec", "Tenant Manager refused the request (HTTP 422)", { status: 422, fieldErrors });
const ambiguous = () => new TMError("ambiguous", "the request may or may not have been recorded");
const retryLater = (retryAfterSeconds?: number) =>
  new TMError("retry_later", "Tenant Manager is busy", { status: 503, tmCode: "retry_later", retryAfterSeconds });

// refusal submits the contract input with set applied and returns what it threw.
function refusal(h: ReturnType<typeof harness>, set: Record<string, unknown>): Promise<unknown> {
  return h.submitter.submit(input(set)).catch((err: unknown) => err);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("before anything reaches TM", () => {
  test("a submit before the options were read is refused", async () => {
    const h = harness([], { options: { current: () => undefined } });
    await expect(h.submitter.submit(input())).rejects.toMatchObject({ code: "options_required" });
    expect(h.postJSON).not.toHaveBeenCalled();
  });

  test("a spec that fails validation sends nothing and uses no attempt", async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) {
      const err = await refusal(h, { "fields.title.value": "Acme https://evil.example" });
      expect(err).toBeInstanceOf(SubmitError);
      expect(err).toMatchObject({
        code: "invalid_spec",
        fieldErrors: [{ path: "fields.title.value", code: "free_text" }],
      });
    }
    expect(h.postJSON).not.toHaveBeenCalled();
    await expect(h.submitter.submit(input())).resolves.toMatchObject({ status: "recorded" });
    expect(h.postJSON).toHaveBeenCalledTimes(1);
  });

  test("an id outside the options is refused", async () => {
    const h = harness();
    expect(await refusal(h, { "fields.subscription.planId.value": "plan-enterprise" })).toMatchObject({
      code: "invalid_spec",
      fieldErrors: [{ path: "fields.subscription.planId.value", code: "not_in_options" }],
    });
    expect(h.postJSON).not.toHaveBeenCalled();
  });

  test.each([
    ["another listed server", "pg-b", "not_preview_suggestion"],
    ["a server TM doesn't list", "prod-pg-2", "unknown_server"],
  ])("a placement that is %s is refused", async (_, server, code) => {
    const h = harness();
    expect(await refusal(h, { "fields.placement.postgresServerId.value": server })).toMatchObject({
      code: "invalid_spec",
      fieldErrors: [{ path: "fields.placement.postgresServerId.value", code }],
    });
    expect(h.postJSON).not.toHaveBeenCalled();
  });

  test("a text that redaction makes too long is refused, as TM would refuse the text it receives", async () => {
    const h = harness();
    // 49,998 characters, and 50,004 once "abcd" becomes "[redacted]".
    const sourceText = `${SOURCE}\npassword: abcd ${"a".repeat(49982 - SOURCE.length)}`;
    await expect(h.submitter.submit(input({ sourceText }))).rejects.toMatchObject({
      code: "invalid_spec",
      fieldErrors: [{ path: "sourceText", code: "source_too_long_after_redaction" }],
    });
    await expect(h.submitter.submit(input({ sourceText: `${sourceText}a` }))).rejects.toMatchObject({
      fieldErrors: [{ path: "sourceText", code: "source_too_long_after_redaction" }],
    });
    await expect(h.submitter.submit(input({ sourceText: `${sourceText}aaa` }))).rejects.toMatchObject({
      fieldErrors: [{ path: "sourceText", code: "source_too_long" }],
    });
    expect(h.postJSON).not.toHaveBeenCalled();
  });
});

const evidenceOf = (body: Record<string, unknown> | undefined, field: string) =>
  (body?.fields as Record<string, { evidence: string[] }>)[field]?.evidence;

describe("layer-1 redaction and hidden text", () => {
  const secrets = `\nTemp password: Welcome@123\nKey ${TMK}\nDSN postgres://lms:S3cretPw@db.acme.internal:5432/lms`;

  test("secrets in the text and quotes are redacted before they are sent", async () => {
    const h = harness();
    const result = await h.submitter.submit(
      input({
        sourceText: SOURCE + secrets,
        "fields.title.evidence": ["Acme Learning Pvt Ltd", "Temp password: Welcome@123", "Welcome@123"],
        "fields.companyId.evidence": ["company id RC-4471", `Key ${TMK}`],
      }),
    );
    const [body] = h.sent();
    const raw = h.bodies[0] ?? "";
    for (const secret of ["Welcome@123", TMK, "S3cretPw"]) {
      expect(raw).not.toContain(secret);
    }
    expect(body?.sourceText).toBe(
      `${SOURCE}\nTemp password: [redacted]\nKey [redacted]\nDSN postgres://lms:[redacted]@db.acme.internal:5432/lms`,
    );
    const fields = body?.fields as Record<string, { evidence: string[]; value: unknown }>;
    expect(fields.title?.evidence).toEqual(["Acme Learning Pvt Ltd", "Temp password: [redacted]", "[redacted]"]);
    expect(fields.companyId?.evidence).toEqual(["company id RC-4471", "Key [redacted]"]);
    expect(fields.title?.value).toBe("Acme Learning Pvt Ltd");
    // The plugin's three and TM's one, summed by kind in TM's order.
    expect(result.redactions).toEqual([
      { code: "tm_agent_key", count: 1 },
      { code: "url_credentials", count: 1 },
      { code: "password_line", count: 2 },
    ]);
    expect(result.hiddenCharacters).toEqual([]);
  });

  test("hidden characters and line endings reach TM as pasted, for TM to strip and count", async () => {
    const h = harness();
    const crlf = SOURCE.replaceAll("\n", "\r\n").replace("Acme Learning", "Acme\u202e Learning\u2066");
    const sourceText = `\u200b${crlf}\r\n\u{e0055}\u{e0053}\u{e0045}`;
    const quote = "Acme\u200d Learning Pvt Ltd";
    const result = await h.submitter.submit(input({ sourceText, "fields.title.evidence": [quote] }));
    const [body] = h.sent();
    const stripped = [
      { code: "bidi_control", count: 2 },
      { code: "zero_width", count: 1 },
      { code: "tag_character", count: 3 },
    ];
    expect(body?.sourceText).toBe(sourceText);
    expect(normalizeText(String(body?.sourceText))).toEqual({ text: SOURCE, stripped });
    expect(result.hiddenCharacters).toEqual(stripped);
    expect(evidenceOf(body, "title")).toEqual(["Acme Learning Pvt Ltd"]);
  });

  test("a secret split by hidden characters is replaced in the paste itself, as TM will see it", async () => {
    const h = harness();
    const key = `${TMK.slice(0, 30)}\u{e0041}${TMK.slice(30)}`;
    const sourceText = `${SOURCE}\r\nTemp pass\u200bword: Wel\u200dcome@123\r\nKey ${key}\u2066\r\n`;
    const quotes = ["Acme Learning Pvt Ltd", "Temp password: Welcome@123"];
    const result = await h.submitter.submit(input({ sourceText, "fields.title.evidence": quotes }));
    const [body] = h.sent();
    const raw = h.bodies[0] ?? "";
    for (const part of ["Wel", "come@123", TMK.slice(0, 30), TMK.slice(30)]) {
      expect(raw).not.toContain(part);
    }
    expect(body?.sourceText).toBe(
      `${SOURCE}\r\nTemp pass\u200bword: [redacted]\u200d\r\nKey [redacted]\u{e0041}\u2066\r\n`,
    );
    expect(body?.sourceText).toBe(redactRaw(sourceText).text);
    const pasted = normalizeText(sourceText);
    const seen = normalizeText(String(body?.sourceText));
    expect(seen).toEqual({ text: redact(pasted.text).text, stripped: pasted.stripped });
    expect(seen.text).toBe(`${SOURCE}\nTemp password: [redacted]\nKey [redacted]`);
    expect(evidenceOf(body, "title")).toEqual(["Acme Learning Pvt Ltd", "Temp password: [redacted]"]);
    expect(result.redactions).toEqual([
      { code: "tm_agent_key", count: 1 },
      { code: "password_line", count: 2 },
    ]);
    expect(result.hiddenCharacters).toEqual([
      { code: "bidi_control", count: 1 },
      { code: "zero_width", count: 2 },
      { code: "tag_character", count: 1 },
    ]);
  });

  test("a lone surrogate is sent as the U+FFFD TM reads it as, in the text and in a quote", async () => {
    const h = harness();
    const spec = input({ sourceText: `${SOURCE}\nref x\ud800y`, "fields.title.evidence": ["ref x\udbffy"] });
    await expect(h.submitter.submit(spec)).resolves.toMatchObject({ status: "recorded" });
    const [body] = h.sent();
    expect(h.bodies[0]).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
    expect(body?.sourceText).toBe(`${SOURCE}\nref x\ufffdy`);
    expect(evidenceOf(body, "title")).toEqual(["ref x\ufffdy"]);
  });

  test("a quote that is a secret only on its own is sent as given when the text had nothing redacted", async () => {
    const h = harness();
    const key = `sk-${"k".repeat(24)}`;
    await h.submitter.submit(input({ sourceText: `${SOURCE}\nref x${key}`, "fields.title.evidence": [key] }));
    const [body] = h.sent();
    expect(body?.sourceText).toBe(`${SOURCE}\nref x${key}`);
    expect(evidenceOf(body, "title")).toEqual([key]);
  });

  test("such a quote is sent as the redaction token when the text has one", async () => {
    const h = harness();
    const key = "xAKIAABCDEFGHIJKLMNOP ok";
    const sourceText = `${SOURCE}\nref ${key}\npassword: hunter22`;
    await h.submitter.submit(input({ sourceText, "fields.title.evidence": ["AKIAABCDEFGHIJKLMNOP ok"] }));
    const [body] = h.sent();
    expect(body?.sourceText).toBe(`${SOURCE}\nref ${key}\npassword: [redacted]`);
    expect(evidenceOf(body, "title")).toEqual(["[redacted]"]);
  });

  test("SECRET_KINDS is the order text.ts counts kinds in", () => {
    const oneOfEach = [
      "password: hunter22",
      `ghp_${"a".repeat(36)}`,
      "AKIAABCDEFGHIJKLMNOP",
      `sk-${"b".repeat(24)}`,
      `sk-ant-${"c".repeat(24)}`,
      "?sig=abcdefghijklmnop1234",
      "AccountKey=abc123;",
      "postgres://u:S3cretPw@db",
      `eyJ${"d".repeat(10)}.${"e".repeat(10)}.${"f".repeat(10)}`,
      "inx_acme_prod_01234567-89ab-cdef-0123-456789abcdef",
      TMK,
      "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----",
    ].join("\n x ");
    expect(redact(oneOfEach).redactions).toEqual(SECRET_KINDS.map((code) => ({ code, count: 1 })));
  });
});

describe("the request id", () => {
  test("is a ULID made at the first send, from the random source", async () => {
    const h = harness([], { random: (n) => Buffer.alloc(n, 0xff) });
    h.advance(5 * MINUTE);
    await h.submitter.submit(input());
    const id = h.sent()[0]?.clientRequestId ?? "";
    expect(id).toMatch(ULID);
    expect(ulidTime(id)).toBe(T0 + 5 * MINUTE);
    expect(id.slice(10)).toBe("Z".repeat(16));
  });

  test("takes its random part from crypto.randomBytes by default", async () => {
    // Ten bytes whose 80 bits are the Crockford digits 0 to F.
    const bytes = Buffer.from("00443214c74254b635cf", "hex");
    vi.mocked(randomBytes).mockClear().mockImplementationOnce(() => bytes as never);
    const h = harness([], { random: undefined });
    await h.submitter.submit(input());
    expect(randomBytes).toHaveBeenCalledExactlyOnceWith(10);
    expect(h.sent()[0]?.clientRequestId.slice(10)).toBe("0123456789ABCDEF");
  });

  test("uses crypto randomness by default", async () => {
    const a = harness([], { random: undefined });
    const b = harness([], { random: undefined });
    await a.submitter.submit(input());
    await b.submitter.submit(input());
    const [x, y] = [a.sent()[0]?.clientRequestId ?? "", b.sent()[0]?.clientRequestId ?? ""];
    expect(x).toMatch(ULID);
    expect(x.slice(10)).not.toBe(y.slice(10));
  });

  test("is kept after a 422, which proves nothing was stored", async () => {
    const h = harness([invalid({ path: "fields.title.value", code: "length" })]);
    await expect(h.submitter.submit(input())).rejects.toMatchObject({ code: "invalid_spec" });
    h.advance(MINUTE);
    await h.submitter.submit(input({ "fields.title.value": "Acme" }));
    const [first, second] = h.sent();
    expect(second?.clientRequestId).toBe(first?.clientRequestId);
  });

  test("is replaced after TM reports clock skew", async () => {
    const h = harness([invalid({ path: "clientRequestId", code: "request_id_clock_skew" })]);
    await expect(h.submitter.submit(input())).rejects.toMatchObject({
      code: "invalid_spec",
      fieldErrors: [{ path: "clientRequestId", code: "request_id_clock_skew" }],
    });
    await h.submitter.submit(input());
    const [first, second] = h.sent();
    expect(second?.clientRequestId).not.toBe(first?.clientRequestId);
    expect(second?.clientRequestId).toMatch(ULID);
  });

  test("is replaced before it gets too old for TM's clock check", async () => {
    const h = harness([invalid({ path: "fields.title.value", code: "length" })]);
    await expect(h.submitter.submit(input())).rejects.toMatchObject({ code: "invalid_spec" });
    h.advance(11 * MINUTE);
    await h.submitter.submit(input());
    const [first, second] = h.sent();
    expect(second?.clientRequestId).not.toBe(first?.clientRequestId);
    expect(ulidTime(second?.clientRequestId ?? "")).toBe(T0 + 11 * MINUTE);
  });
});

describe("attempts", () => {
  test("after three 422s the next submit is refused without a send", async () => {
    const refusal = invalid({ path: "fields.title.value", code: "free_text" });
    const h = harness([refusal, refusal, refusal]);
    for (let i = 0; i < 3; i++) {
      await expect(h.submitter.submit(input())).rejects.toMatchObject({
        code: "invalid_spec",
        fieldErrors: [{ path: "fields.title.value", code: "free_text" }],
      });
    }
    await expect(h.submitter.submit(input())).rejects.toMatchObject({ code: "too_many_attempts" });
    expect(h.postJSON).toHaveBeenCalledTimes(3);
  });

  test.each([
    new TMError("rate_limited", "rate limited", { status: 429, retryAfterSeconds: 7 }),
    new TMError("daily_cap", "the daily limit of provisioning requests is reached", { status: 429 }),
    new TMError("unavailable", "Tenant Manager is unavailable", { status: 503, tmCode: "provisioning_unavailable" }),
    new TMError("too_large", "the request is too large", { status: 413 }),
    new TMError("refused", "the agent key is refused"),
  ])("TM's $code is passed on and leaves the session open", async (err) => {
    const h = harness([err]);
    const got = await h.submitter.submit(input()).catch((e) => e);
    expect(got).toBeInstanceOf(SubmitError);
    expect(got).toMatchObject({ code: err.code, message: err.message, retryAfterSeconds: err.retryAfterSeconds });
    await expect(h.submitter.submit(input({ summary: "Changed after the error." }))).resolves.toMatchObject({
      status: "recorded",
    });
  });
});

describe("a send whose answer was lost", () => {
  test("is retried twice with the same id and body, a second apart", async () => {
    vi.useFakeTimers();
    const h = harness([ambiguous(), ambiguous()]);
    const run = settle(h.submitter.submit(input()));
    await vi.advanceTimersByTimeAsync(999);
    expect(h.postJSON).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.postJSON).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await run).value).toMatchObject({ status: "recorded" });
    expect(h.bodies).toHaveLength(3);
    expect(new Set(h.bodies).size).toBe(1);
  });

  test.each([
    [5, 2000],
    [1, 1000],
    [undefined, 1000],
  ])("retry_later with Retry-After %s waits %d ms", async (seconds, wait) => {
    vi.useFakeTimers();
    const h = harness([retryLater(seconds)]);
    const run = settle(h.submitter.submit(input()));
    await vi.advanceTimersByTimeAsync(wait - 1);
    expect(h.postJSON).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await run).value).toMatchObject({ status: "recorded" });
    expect(new Set(h.bodies).size).toBe(1);
  });

  test("locks the session to that exact body until TM answers it", async () => {
    vi.useFakeTimers();
    const h = harness([ambiguous(), retryLater(2), ambiguous()]);
    const first = settle(h.submitter.submit(input()));
    await vi.advanceTimersByTimeAsync(5000);
    expect((await first).error).toMatchObject({ code: "ambiguous" });
    expect(h.postJSON).toHaveBeenCalledTimes(3);

    await expect(h.submitter.submit(input({ summary: "A different summary." }))).rejects.toMatchObject({
      code: "submit_pending",
    });
    expect(await refusal(h, { "fields.title.value": "" })).toMatchObject({ code: "submit_pending" });
    expect(h.postJSON).toHaveBeenCalledTimes(3);

    h.advance(30 * MINUTE);
    const replay = (id: string) => ({ status: 200, body: tmAnswer(id, { replayed: true }) });
    h.postJSON.mockImplementationOnce(async (_path, body) => {
      h.bodies.push(JSON.stringify(body));
      return replay((body as { clientRequestId: string }).clientRequestId);
    });
    await expect(h.submitter.submit(input())).resolves.toMatchObject({ replayed: true });
    expect(h.bodies).toHaveLength(4);
    expect(new Set(h.bodies).size).toBe(1);
    await expect(h.submitter.submit(input())).rejects.toMatchObject({ code: "already_submitted" });
  });

  test.each([
    ["ambiguous", ambiguous, "the request may or may not have been recorded"],
    ["retry_later", retryLater, "Tenant Manager is busy"],
  ])("%s, once the resends run out, says how to go on", async (code, answer, message) => {
    vi.useFakeTimers();
    const h = harness([answer(), answer(), answer()]);
    const first = settle(h.submitter.submit(input()));
    await vi.advanceTimersByTimeAsync(5000);
    expect((await first).error).toMatchObject({
      code,
      message: `${message}; resend it unchanged, or start a new session`,
    });
    expect(await refusal(h, { summary: "Something else." })).toMatchObject({
      code: "submit_pending",
      message: "a previous submit may have been recorded; resend it unchanged, or start a new session",
    });
  });

  test("stays locked after an error that proves nothing", async () => {
    vi.useFakeTimers();
    const unavailable = new TMError("unavailable", "Tenant Manager at http://localhost could not be reached");
    const h = harness([ambiguous(), unavailable]);
    const first = settle(h.submitter.submit(input()));
    await vi.advanceTimersByTimeAsync(1000);
    expect((await first).error).toMatchObject({
      code: "unavailable",
      message: "Tenant Manager at http://localhost could not be reached; resend it unchanged, or start a new session",
    });
    await expect(h.submitter.submit(input({ summary: "Something else." }))).rejects.toMatchObject({
      code: "submit_pending",
    });
  });

  test("stays locked when its resend fails before TM answers", async () => {
    vi.useFakeTimers();
    const unavailable = new TMError("unavailable", "Tenant Manager at http://localhost could not be reached");
    const h = harness([ambiguous(), ambiguous(), ambiguous(), unavailable]);
    const first = settle(h.submitter.submit(input()));
    await vi.advanceTimersByTimeAsync(5000);
    expect((await first).error).toMatchObject({ code: "ambiguous" });
    await expect(h.submitter.submit(input())).rejects.toMatchObject({ code: "unavailable" });
    expect(await refusal(h, { summary: "Something else." })).toMatchObject({ code: "submit_pending" });
    expect(h.postJSON).toHaveBeenCalledTimes(4);
  });

  test("is released by a 422, which proves TM stored nothing", async () => {
    vi.useFakeTimers();
    const refused = invalid({ path: "clientRequestId", code: "invalid_format" });
    const h = harness([ambiguous(), ambiguous(), ambiguous(), refused]);
    const first = settle(h.submitter.submit(input()));
    await vi.advanceTimersByTimeAsync(5000);
    expect((await first).error).toMatchObject({ code: "ambiguous" });
    await expect(h.submitter.submit(input())).rejects.toMatchObject({ code: "invalid_spec" });
    await expect(h.submitter.submit(input({ summary: "Fixed after the refusal." }))).resolves.toMatchObject({
      status: "recorded",
    });
    const ids = h.sent().map((b) => b.clientRequestId);
    expect(new Set(ids).size).toBe(1);
  });
});

describe("one request per session", () => {
  test.each([
    ["201", 201, false],
    ["200 replay", 200, true],
  ])("after a %s every later submit is refused", async (_, status, replayed) => {
    const h = harness([(id) => ({ status, body: tmAnswer(id, { replayed }) })]);
    await expect(h.submitter.submit(input())).resolves.toMatchObject({ replayed });
    const err = await h.submitter.submit(input({ summary: "The next request." })).catch((e) => e);
    expect(err).toMatchObject({ code: "already_submitted", message: "start a new session for the next request" });
    expect(h.postJSON).toHaveBeenCalledTimes(1);
  });

  test("a conflict ends the session too", async () => {
    const h = harness([new TMError("conflict", "this request id was already used", { status: 409 })]);
    await expect(h.submitter.submit(input())).rejects.toMatchObject({ code: "conflict" });
    await expect(h.submitter.submit(input())).rejects.toMatchObject({ code: "already_submitted" });
    expect(h.postJSON).toHaveBeenCalledTimes(1);
  });

  test("parallel submits record one request", async () => {
    const h = harness();
    const [a, b] = await Promise.all([settle(h.submitter.submit(input())), settle(h.submitter.submit(input()))]);
    expect(a.value).toMatchObject({ status: "recorded" });
    expect(b.error).toMatchObject({ code: "already_submitted" });
    expect(h.postJSON).toHaveBeenCalledTimes(1);
  });
});

describe("the result", () => {
  test("keeps only the allowlisted fields and well-formed codes", async () => {
    const h = harness([
      (id) => ({
        status: 201,
        body: {
          ...tmAnswer(id),
          mode: "Shadow Mode",
          canary: "CANARY-PW-1",
          checks: [
            { code: "tenant_key_available", result: "pass", detail: "CANARY-DETAIL", count: 0 },
            { code: "Bad Code", result: "pass" },
            { code: "secret_scan", result: "<img src=x>" },
            { code: "hidden_text", result: "removed", severity: "Warning!", reason: "a reason", count: 3 },
            { code: "company_id_available", result: "unknown", count: -1 },
            {
              code: "placement_matches_preview",
              result: "differs",
              fields: ["fields.placement.postgresServerId", "x"],
            },
            "not an object",
          ],
          redactions: [{ code: "password_line", count: 2 }, { code: "Bad", count: 1 }, { code: "jwt", count: 0 }],
        },
      }),
    ]);
    const result = await h.submitter.submit(input());
    const id = h.sent()[0]?.clientRequestId;
    expect(result).toEqual({
      requestId: `pr-${id}`,
      mode: "",
      status: "recorded",
      readiness: "complete",
      replayed: false,
      checks: [
        { code: "tenant_key_available", result: "pass" },
        { code: "hidden_text", result: "removed", count: 3 },
        { code: "company_id_available", result: "unknown" },
        { code: "placement_matches_preview", result: "differs", fields: ["fields.placement.postgresServerId"] },
      ],
      redactions: [{ code: "password_line", count: 2 }],
      hiddenCharacters: [],
    });
    expect(JSON.stringify(result)).not.toContain("CANARY");
  });

  test("TM's redactions are added to the plugin's by kind in TM's order, with unknown kinds last", async () => {
    const tmCounts = [
      { code: "new_kind", count: 1 },
      { code: "password_line", count: 1 },
      { code: "jwt", count: 2 },
      { code: "password_line", count: 1 },
    ];
    const h = harness([(id) => ({ status: 201, body: tmAnswer(id, { redactions: tmCounts }) })]);
    const sourceText = `${SOURCE}\npassword: hunter22 and ${TMK}`;
    const result = await h.submitter.submit(input({ sourceText }));
    expect(result.redactions).toEqual([
      { code: "tm_agent_key", count: 1 },
      { code: "jwt", count: 2 },
      { code: "password_line", count: 3 },
      { code: "new_kind", count: 1 },
    ]);
  });

  test("an answer with 60 checks and 30 redaction counts comes back with 50 and 20", async () => {
    const letters = (i: number) => String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26));
    const many = {
      checks: Array.from({ length: 60 }, (_, i) => ({ code: `check_${letters(i)}`, result: "pass" })),
      redactions: Array.from({ length: 30 }, (_, i) => ({ code: `kind_${letters(i)}`, count: 1 })),
    };
    const h = harness([(id) => ({ status: 201, body: tmAnswer(id, many) })]);
    const result = await h.submitter.submit(input({ sourceText: `${SOURCE}\npassword: hunter22` }));
    expect(result.checks).toEqual(many.checks.slice(0, 50));
    expect(result.redactions).toEqual([{ code: "password_line", count: 1 }, ...many.redactions.slice(0, 19)]);
  });

  test("a malformed id is dropped", async () => {
    const answer = { status: 201, body: { id: "pr-<script>", pagePath: "/provisioning/requests/" } };
    const h = harness([answer], { env: { TM_UI_URL: "https://tm.example.com" } });
    const result = await h.submitter.submit(input());
    expect(result.requestId).toBe("");
    expect(result.reviewUrl).toBeUndefined();
    expect(result.checks).toEqual([]);
  });

  test.each<[string, string | undefined, string | undefined]>([
    ["https", "https://tm.example.com", "https://tm.example.com/provisioning/requests/"],
    [
      "https with a path prefix",
      "https://tm.example.com/tenants/",
      "https://tm.example.com/tenants/provisioning/requests/",
    ],
    ["http on localhost", "http://localhost:5173", "http://localhost:5173/provisioning/requests/"],
    ["http on 127.0.0.1", " http://127.0.0.1:5173 ", "http://127.0.0.1:5173/provisioning/requests/"],
    ["http elsewhere", "http://tm.example.com", undefined],
    ["credentials", "https://user:pw@tm.example.com", undefined],
    ["a user name", "https://user@tm.example.com", undefined],
    ["a password only", "https://:pw@tm.example.com", undefined],
    ["a query", "https://tm.example.com/?next=x", undefined],
    ["a fragment", "https://tm.example.com/#x", undefined],
    ["another scheme", "javascript:alert(1)", undefined],
    ["not a URL", "tm.example.com", undefined],
    ["unset", undefined, undefined],
  ])("reviewUrl with TM_UI_URL %s", async (_, uiUrl, prefix) => {
    const h = harness([], { env: { TM_UI_URL: uiUrl } });
    const result = await h.submitter.submit(input());
    const id = h.sent()[0]?.clientRequestId;
    expect(result.reviewUrl).toBe(prefix === undefined ? undefined : `${prefix}pr-${id}`);
  });

  test("an answer about another request id gives no id and no link", async () => {
    const other = `pr-${"0".repeat(26)}`;
    const answer = { ...tmAnswer("x"), id: other, pagePath: `/provisioning/requests/${other}` };
    const h = harness([{ status: 201, body: answer }], { env: { TM_UI_URL: "https://tm.example.com" } });
    const result = await h.submitter.submit(input());
    expect(result.requestId).toBe("");
    expect(result.reviewUrl).toBeUndefined();
  });

  test("reviewUrl needs TM's page path for this request", async () => {
    const other = `/provisioning/requests/pr-${"0".repeat(26)}`;
    const h = harness([(id) => ({ status: 201, body: tmAnswer(id, { pagePath: other }) })], {
      env: { TM_UI_URL: "https://tm.example.com" },
    });
    expect((await h.submitter.submit(input())).reviewUrl).toBeUndefined();
  });
});
