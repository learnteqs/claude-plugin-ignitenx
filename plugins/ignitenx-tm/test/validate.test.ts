import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { mapOptions, type AgentOptions } from "../src/options.js";
import { FIELD_PATHS, SubmitInputSchema, type SubmitInput } from "../src/spec.js";
import { decimals, validate } from "../src/validate.js";

const CONTRACT = JSON.parse(readFileSync(new URL("./fixtures/request-v1.json", import.meta.url), "utf8")) as Record<
  string,
  unknown
>;
const THEMES = ["default", "catppuccin", "Bubblegum", "Doom 64", "Twitter", "Notebook", "Kodama Grove", "Vercel"];
const SOURCE = CONTRACT.sourceText as string;
const long = (n: number) => "a".repeat(n);
const cps = (...codes: number[]) => String.fromCodePoint(...codes);
const absent = () => ({ value: null, source: "absent", confidence: 0, evidence: [] });
const stated = (value: unknown, quote = "Acme Learning Pvt Ltd") => ({
  value,
  source: "stated",
  confidence: 0.9,
  evidence: [quote],
});

// options mirrors TM's testOptions in spec/helpers_test.go, as the options endpoint would publish them.
function options(over: Record<string, unknown> = {}): AgentOptions {
  const server = (id: string) => ({ id, name: id, environmentMatch: true });
  return mapOptions({
    schemaVersion: 1,
    optionsVersion: `sha256:${"3f".repeat(32)}`,
    environment: { name: "development", configured: true },
    partnerRequired: true,
    partners: [{ id: "P-102", name: "Repute" }],
    plans: [
      { id: "plan-std", name: "Standard", type: "standard", hasGenAI: false },
      { id: "plan-pro", name: "Pro", type: "standard", hasGenAI: true },
    ],
    languages: ["en", "ta", "kn", "hi", "ar"].map((code) => ({ code, label: code })),
    themes: THEMES,
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
    ...over,
  }).agent;
}

// input is the contract request as the model would send it, with set applied on top by dotted path.
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
  return m as unknown as SubmitInput;
}

function allAbsent(set: Record<string, unknown> = {}): SubmitInput {
  const cleared = Object.fromEntries(FIELD_PATHS.map((p) => [p, absent()]));
  return input({ ...cleared, "triage.isTenantRequest": false, "triage.stage": "not_a_request", ...set });
}

const errorsOf = (set: Record<string, unknown>, o = options()) => validate(input(set), o);

describe("spec schema", () => {
  test("the contract request, without the envelope, is a valid tool input and passes", () => {
    const parsed = SubmitInputSchema.parse(input());
    expect(validate(parsed, options())).toEqual([]);
  });

  test("its fields are exactly FIELD_PATHS, in TM's order", () => {
    const leaves: string[] = [];
    const walk = (shape: Record<string, unknown>, prefix: string) => {
      for (const [key, schema] of Object.entries(shape)) {
        const inner = (schema as { shape: Record<string, unknown> }).shape;
        if ("value" in inner) {
          leaves.push(`${prefix}.${key}`);
        } else {
          walk(inner, `${prefix}.${key}`);
        }
      }
    };
    walk(SubmitInputSchema.shape.fields.shape, "fields");
    expect(leaves).toEqual([...FIELD_PATHS]);
  });

  test.each([
    ["an unknown top-level key", { approved: true }],
    ["TM's envelope", { clientRequestId: "01JB2Q7Z3K8M9N0P1Q2R3S4T5V" }],
    ["a field TM never takes", { "fields.adminPassword": stated("Welcome@123") }],
    ["an extra key in a field", { "fields.title.note": "x" }],
    ["an extra key in triage", { "triage.approved": true }],
    ["an extra key in a flag", { flags: [{ code: "other", field: "", note: "n", severity: "low" }] }],
  ])("refuses %s", (_, set) => {
    const r = SubmitInputSchema.safeParse(input(set));
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.code)).toContain("unrecognized_keys");
  });

  test.each([
    ["a missing field", (m: SubmitInput) => delete (m.fields as Record<string, unknown>).industry],
    ["a missing evidence key", (m: SubmitInput) => delete (m.fields.title as Record<string, unknown>).evidence],
    ["null confidence", (m: SubmitInput) => ((m.fields.title as Record<string, unknown>).confidence = null)],
    ["an unknown source", (m: SubmitInput) => ((m.fields.title as Record<string, unknown>).source = "guessed")],
    ["a number as a text value", (m: SubmitInput) => ((m.fields.title as Record<string, unknown>).value = 7)],
    ["an unknown flag code", (m: SubmitInput) => (m.flags = [{ code: "approved", field: "", note: "" } as never])],
    ["missing flags", (m: SubmitInput) => delete (m as Record<string, unknown>).flags],
  ])("refuses %s, as TM does", (_, change) => {
    const m = input();
    change(m);
    expect(SubmitInputSchema.safeParse(m).success).toBe(false);
  });
});

describe("rules mirrored from TM", () => {
  // Each case is TM's own, from spec/rules_test.go and the hostile fixtures, with TM's exact path and code.
  test.each<[string, Record<string, unknown>, string, string]>([
    ["title of 101", { "fields.title.value": long(101) }, "fields.title.value", "length"],
    ["empty title", { "fields.title.value": "" }, "fields.title.value", "length"],
    ["title with a tab", { "fields.title.value": "Acme\tLearning" }, "fields.title.value", "free_text"],
    ["title not trimmed", { "fields.title.value": " Acme" }, "fields.title.value", "free_text"],
    ["title with www.", { "fields.title.value": "WWW.acme.in" }, "fields.title.value", "free_text"],
    ["title with a backtick", { "fields.title.value": "Acme `x`" }, "fields.title.value", "free_text"],
    [
      "title with an img tag",
      { "fields.title.value": "<img src=x onerror=alert(1)>" },
      "fields.title.value",
      "free_text",
    ],
    ["title with a URL", { "fields.title.value": "Acme https://evil.example" }, "fields.title.value", "free_text"],
    ["title with a bidi override", { "fields.title.value": "Acme\u202eeviL" }, "fields.title.value", "free_text"],
    ["title with tag characters", { "fields.title.value": "Acme\u{e0041}" }, "fields.title.value", "free_text"],
    ["link with no scheme", { "fields.title.value": "Acme zoom.us/j/8123" }, "fields.title.value", "free_text"],
    ["tel: link", { "fields.title.value": "Acme tel:+911234" }, "fields.title.value", "free_text"],
    ["protocol-relative link", { "fields.title.value": "Acme //10.0.0.1/x" }, "fields.title.value", "free_text"],
    ["unlisted scheme", { "fields.title.value": "Acme gopher://10.0.0.1" }, "fields.title.value", "free_text"],
    ["markdown link", { "fields.title.value": "[Acme](acme)" }, "fields.title.value", "free_text"],
    ["industry of 61", { "fields.industry": stated(long(61)) }, "fields.industry.value", "length"],
    ["page title of 101", { "fields.pageTitle": stated(long(101)) }, "fields.pageTitle.value", "length"],
    ["IdP name of 81", { "fields.idpDisplayName": stated(long(81)) }, "fields.idpDisplayName.value", "length"],
    [
      "environment of 41",
      { "fields.requestedEnvironment": stated(long(41)) },
      "fields.requestedEnvironment.value",
      "length",
    ],
    ["region of 41", { "fields.requestedRegion": stated(long(41)) }, "fields.requestedRegion.value", "length"],
    [
      "meeting link in the region",
      { "fields.requestedRegion": stated("teams.microsoft.com/l/x") },
      "fields.requestedRegion.value",
      "free_text",
    ],
    [
      "a secret in the title",
      { "fields.title.value": "AKIAABCDEFGHIJKLMNOP" },
      "fields.title.value",
      "secret_in_value",
    ],
    [
      "an AWS key as company id",
      { "fields.companyId.value": "AKIAABCDEFGHIJKLMNOP" },
      "fields.companyId.value",
      "secret_in_value",
    ],
    [
      "a DSN as admin email",
      { "fields.adminEmail.value": "postgres://u:pw1234@db.acme.in" },
      "fields.adminEmail.value",
      "secret_in_value",
    ],
    [
      "a secret in a language",
      { "fields.enabledLanguages.value": ["en", "token: abcdefgh"] },
      "fields.enabledLanguages.value",
      "secret_in_value",
    ],
    [
      "default language not offered",
      { "fields.defaultLang.value": "fr" },
      "fields.defaultLang.value",
      "not_in_options",
    ],
    [
      "enabled language not offered",
      { "fields.enabledLanguages.value": ["en", "fr"] },
      "fields.enabledLanguages.value",
      "not_in_options",
    ],
    ["no enabled languages", { "fields.enabledLanguages.value": [] }, "fields.enabledLanguages.value", "length"],
    [
      "11 enabled languages",
      { "fields.enabledLanguages.value": Array(11).fill("en") },
      "fields.enabledLanguages.value",
      "length",
    ],
    [
      "duplicate languages",
      { "fields.enabledLanguages.value": ["en", "ta", "en"] },
      "fields.enabledLanguages.value",
      "duplicate",
    ],
    [
      "languages without the default",
      { "fields.enabledLanguages.value": ["ta"] },
      "fields.enabledLanguages.value",
      "default_lang_not_enabled",
    ],
    ["theme in the wrong case", { "fields.theme": stated("doom 64") }, "fields.theme.value", "not_in_options"],
    [
      "theme mode in the wrong case",
      { "fields.themeMode": stated("Dark") },
      "fields.themeMode.value",
      "not_in_options",
    ],
    [
      "subscription status",
      { "fields.subscription.status": stated("suspended") },
      "fields.subscription.status.value",
      "not_in_options",
    ],
    [
      "provider",
      { "fields.subscription.preferredProvider": stated("gemini") },
      "fields.subscription.preferredProvider.value",
      "not_in_options",
    ],
    [
      "plan not offered",
      { "fields.subscription.planId.value": "plan-old" },
      "fields.subscription.planId.value",
      "not_in_options",
    ],
    [
      "budget over the limit",
      { "fields.subscription.monthlyBudget": stated(1000000.01) },
      "fields.subscription.monthlyBudget.value",
      "out_of_range",
    ],
    [
      "negative budget",
      { "fields.subscription.monthlyBudget": stated(-1) },
      "fields.subscription.monthlyBudget.value",
      "out_of_range",
    ],
    [
      "budget too precise",
      { "fields.subscription.monthlyBudget": stated(10.005) },
      "fields.subscription.monthlyBudget.value",
      "too_precise",
    ],
    ["confidence 0.29", { "fields.title.confidence": 0.29 }, "fields.title.confidence", "confidence_band"],
    ["confidence 0.955", { "fields.title.confidence": 0.955 }, "fields.title.confidence", "too_precise"],
    ["confidence 1e-7", { "triage.confidence": 1e-7 }, "triage.confidence", "too_precise"],
    ["negative confidence", { "fields.title.confidence": -0.1 }, "fields.title.confidence", "out_of_range"],
    ["confidence over one", { "fields.title.confidence": 1.5 }, "fields.title.confidence", "out_of_range"],
    [
      "default option on",
      { "fields.options.groups": { value: true, source: "default", confidence: 1, evidence: [] } },
      "fields.options.groups.value",
      "not_default",
    ],
    [
      "default option null",
      { "fields.options.groups": { value: null, source: "default", confidence: 1, evidence: [] } },
      "fields.options.groups.value",
      "not_default",
    ],
    ["default theme not the default", { "fields.theme.value": "Vercel" }, "fields.theme.value", "not_default"],
    [
      "default languages not the default",
      { "fields.enabledLanguages": { value: ["en", "ta"], source: "default", confidence: 1, evidence: [] } },
      "fields.enabledLanguages.value",
      "not_default",
    ],
    [
      "default with evidence",
      { "fields.theme.evidence": ["Acme Learning Pvt Ltd"] },
      "fields.theme.evidence",
      "evidence_not_allowed",
    ],
    ["default below full confidence", { "fields.theme.confidence": 0.9 }, "fields.theme.confidence", "confidence_band"],
    [
      "default for the tenant key",
      { "fields.tenantKey": { value: "acme", source: "default", confidence: 1, evidence: [] } },
      "fields.tenantKey.source",
      "source_not_allowed",
    ],
    ["stated null", { "fields.title.value": null }, "fields.title.value", "value_required"],
    ["stated without evidence", { "fields.title.evidence": [] }, "fields.title.evidence", "evidence_required"],
    [
      "chosen title",
      { "fields.title": { value: "Acme", source: "chosen", confidence: 0.9, evidence: [] } },
      "fields.title.source",
      "source_not_allowed",
    ],
    [
      "chosen placement without a value",
      { "fields.placement.blobAccountId.value": null },
      "fields.placement.blobAccountId.value",
      "value_required",
    ],
    [
      "chosen at confidence 0",
      { "fields.placement.blobAccountId.confidence": 0 },
      "fields.placement.blobAccountId.confidence",
      "confidence_band",
    ],
    [
      "chosen with evidence",
      { "fields.placement.blobAccountId.evidence": ["Standard plan"] },
      "fields.placement.blobAccountId.evidence",
      "evidence_not_allowed",
    ],
    ["absent with a value", { "fields.industry.value": "Education" }, "fields.industry.value", "value_not_null"],
    ["absent with confidence", { "fields.industry.confidence": 0.5 }, "fields.industry.confidence", "confidence_band"],
    ["an unknown source", { "fields.title.source": "guessed" }, "fields.title.source", "bad_source"],
    [
      "too many quotes",
      { "fields.title.evidence": ["Acme", "Acme", "Acme", "Acme"] },
      "fields.title.evidence",
      "too_many_quotes",
    ],
    ["a quote of 301", { "fields.title.evidence": [long(301)] }, "fields.title.evidence[0]", "quote_length"],
    ["a quote of whitespace", { "fields.title.evidence": [" \t\n"] }, "fields.title.evidence[0]", "quote_length"],
    [
      "a quote of hidden characters",
      { "fields.title.evidence": ["\u200b\u202e"] },
      "fields.title.evidence[0]",
      "quote_length",
    ],
    [
      "a quote with a lone surrogate, which TM reads as U+FFFD",
      { "fields.title.evidence": ["Acme\ud800"] },
      "fields.title.evidence[0]",
      "evidence_not_in_source",
    ],
    [
      "a fabricated quote",
      { "fields.title.evidence": ["Acme", "pre-approved by Learnteq"] },
      "fields.title.evidence[1]",
      "evidence_not_in_source",
    ],
    [
      "a quote in the wrong case",
      { "fields.title.evidence": ["acme learning pvt ltd"] },
      "fields.title.evidence[0]",
      "evidence_not_in_source",
    ],
    [
      "placement not in the registry",
      { "fields.placement.postgresServerId.value": "prod-pg-2" },
      "fields.placement.postgresServerId.value",
      "unknown_server",
    ],
    [
      "placement in the wrong case",
      { "fields.placement.mongoServerId.value": "Local-Mongo" },
      "fields.placement.mongoServerId.value",
      "unknown_server",
    ],
    ["partner outside the options", { "fields.partnerId.value": "P-117" }, "fields.partnerId", "partner_not_allowed"],
    ["partner missing for a scoped key", { "fields.partnerId": absent() }, "fields.partnerId", "partner_not_allowed"],
    ["empty summary", { summary: "" }, "summary", "length"],
    ["summary of 501", { summary: long(501) }, "summary", "length"],
    ["summary with a link", { summary: "See https://acme.in" }, "summary", "free_text"],
    ["protocol-relative link in the summary", { summary: "See //acme.in/x" }, "summary", "free_text"],
    ["summary with a JWT", { summary: `Token eyJ${long(10)}.${long(10)}.${long(10)}` }, "summary", "secret_in_value"],
    ["summary with an env password", { summary: "DB_PASSWORD=hunter22" }, "summary", "secret_in_value"],
    ["summary with a text selector", { summary: `Great${cps(0xfe00)}` }, "summary", "free_text"],
    ["summary with an emoji selector after a letter", { summary: `Great${cps(0xfe0f)}` }, "summary", "free_text"],
    ["summary with an emoji selector after =", { summary: `Rating =${cps(0xfe0f)}` }, "summary", "free_text"],
    ["summary with an emoji selector after a digit", { summary: `Floor 7${cps(0xfe0f)}` }, "summary", "free_text"],
    ["title with a grapheme joiner", { "fields.title.value": `Ac${cps(0x34f)}me` }, "fields.title.value", "free_text"],
    [
      "note with a Hangul filler",
      { flags: [{ code: "other", field: "", note: `see${cps(0x3164)}` }] },
      "flags[0].note",
      "free_text",
    ],
    ["source that is only hidden characters", { sourceText: "\u200b\u200d\u2066 \n" }, "sourceText", "source_empty"],
    ["source too long", { sourceText: long(50001) }, "sourceText", "source_too_long"],
    [
      "source too long with hidden characters left out",
      { sourceText: `\u200b${long(50001)}` },
      "sourceText",
      "source_too_long",
    ],
    ["triage confidence over one", { "triage.confidence": 1.2 }, "triage.confidence", "out_of_range"],
    ["triage confidence too precise", { "triage.confidence": 0.951 }, "triage.confidence", "too_precise"],
    ["unknown stage", { "triage.stage": "maybe" }, "triage.stage", "not_in_options"],
    ["stage contradicts triage", { "triage.stage": "not_a_request" }, "triage.stage", "triage_inconsistent"],
    ["a request marked not_a_request", { "triage.isTenantRequest": false }, "triage.stage", "triage_inconsistent"],
    ["unknown flag", { flags: [{ code: "approved", field: "", note: "" }] }, "flags[0].code", "unknown_flag"],
    [
      "flag on an unknown field",
      { flags: [{ code: "other", field: "fields.adminPassword", note: "n" }] },
      "flags[0].field",
      "unknown_field_path",
    ],
    ["other without a note", { flags: [{ code: "other", field: "", note: "" }] }, "flags[0].note", "note_required"],
    [
      "source_trimmed without a note",
      { flags: [{ code: "source_trimmed", field: "", note: "" }] },
      "flags[0].note",
      "note_required",
    ],
    [
      "multiple_requests without a note",
      { flags: [{ code: "multiple_requests", field: "", note: "" }] },
      "flags[0].note",
      "note_required",
    ],
    ["flag note of 201", { flags: [{ code: "other", field: "", note: long(201) }] }, "flags[0].note", "length"],
    [
      "websocket link in a note",
      { flags: [{ code: "other", field: "", note: "wss://acme.in/x" }] },
      "flags[0].note",
      "free_text",
    ],
    [
      "password in a note",
      { flags: [{ code: "other", field: "", note: "password: Welcome@123" }] },
      "flags[0].note",
      "secret_in_value",
    ],
    [
      "too many flags",
      { flags: Array(21).fill({ code: "non_english", field: "", note: "" }) },
      "flags",
      "too_many_flags",
    ],
  ])("%s", (_, set, path, code) => {
    expect(errorsOf(set)).toContainEqual({ path, code });
  });

  test("a field of a non-request must be absent", () => {
    const errs = validate(allAbsent({ "fields.partnerId": stated("P-102", "via Repute") }), options());
    expect(errs).toEqual([{ path: "fields.partnerId", code: "triage_inconsistent" }]);
    expect(validate(allAbsent(), options())).toEqual([]);
  });

  test("a non-request needs no partner, even for a scoped key", () => {
    expect(validate(allAbsent(), options({ partnerRequired: true }))).toEqual([]);
  });

  test("a chosen partner needs exactly one partner in the options", () => {
    const chosen = { "fields.partnerId": { value: "P-102", source: "chosen", confidence: 0.4, evidence: [] } };
    expect(errorsOf(chosen)).toEqual([]);
    const two = options({ partners: [{ id: "P-102", name: "Repute" }, { id: "P-117", name: "Other" }] });
    expect(errorsOf(chosen, two)).toEqual([{ path: "fields.partnerId.source", code: "source_not_allowed" }]);
  });

  test("no partner is needed when the key may submit without one", () => {
    expect(errorsOf({ "fields.partnerId": absent() }, options({ partnerRequired: false }))).toEqual([]);
  });

  test("a source that fails its own rule skips the quote lookup, as TM does", () => {
    const errs = errorsOf({ sourceText: "", "fields.title.evidence": ["not in any text"] });
    expect(errs).toEqual([{ path: "sourceText", code: "source_empty" }]);
  });

  // TM leaves these formats to itself, and none of them allows a hidden character, so each such value gets TM's code.
  test.each<[string, string, string]>([
    ["fields.tenantKey", "acme\u200b-learning", "invalid_format"],
    ["fields.companyId", "RC-\u00ad4471", "invalid_format"],
    ["fields.adminUserName", "priya\u202e.n", "invalid_format"],
    ["fields.adminEmail", "priya.n@acme\u2060learning.in", "invalid_format"],
    ["fields.statedRequesterEmail", "priya.n@acmelearning.in\u{e0041}", "invalid_format"],
    ["fields.adminEmail", "priya.n@acmelearning.in\r", "invalid_format"],
    ["fields.timeZone", "Asia/Kolkata\ufeff", "invalid_time_zone"],
    ["fields.timeZone", "UTC\u{e0100}", "invalid_time_zone"],
    ["fields.tenantKey", `acme${cps(0x3164)}-learning`, "invalid_format"],
    ["fields.timeZone", `Asia/Kolkata${cps(0xfe0f)}`, "invalid_time_zone"],
  ])("%s with a hidden character, %j, is TM's %s", (field, value, code) => {
    expect(errorsOf({ [`${field}.value`]: value })).toEqual([{ path: `${field}.value`, code }]);
  });

  test.each([
    ["AKIAABCDEFGHIJKLMNOP\u200b", "secret_in_value"],
    ["AKIA\u200bABCDEFGHIJKLMNOP", "invalid_format"],
  ])("a secret in such a field is checked first, as TM does: %j is %s", (value, code) => {
    expect(errorsOf({ "fields.companyId.value": value })).toEqual([{ path: "fields.companyId.value", code }]);
  });

  test("a paste that fits only before its secrets are replaced is refused, with the quotes still checked", () => {
    // 49,998 characters, and 50,004 once "abcd" becomes "[redacted]".
    const sourceText = `${SOURCE}\npassword: abcd ${long(49982 - SOURCE.length)}`;
    expect(errorsOf({ sourceText, "fields.title.evidence": ["not in the text"] })).toEqual([
      { path: "sourceText", code: "source_too_long_after_redaction" },
      { path: "fields.title.evidence[0]", code: "evidence_not_in_source" },
    ]);
    expect(errorsOf({ sourceText: `${SOURCE}\npassword: abcd ${long(49976 - SOURCE.length)}` })).toEqual([]);
  });

  test("errors come in TM's order and stop at 20", () => {
    const bogus = { value: null, source: "bogus", confidence: 2, evidence: ["x", "y"] };
    const set = Object.fromEntries(FIELD_PATHS.map((p) => [p, bogus]));
    const errs = errorsOf({ summary: "", sourceText: "", ...set });
    expect(errs).toHaveLength(20);
    expect(errs.slice(0, 5)).toEqual([
      { path: "summary", code: "length" },
      { path: "sourceText", code: "source_empty" },
      { path: "fields.tenantKey.source", code: "bad_source" },
      { path: "fields.tenantKey.confidence", code: "out_of_range" },
      { path: "fields.title.source", code: "bad_source" },
    ]);
  });
});

describe("the placement rule of the plugin's own", () => {
  test("a server in the registry but not the preview's suggestion is refused", () => {
    expect(errorsOf({ "fields.placement.postgresServerId.value": "pg-b" })).toEqual([
      { path: "fields.placement.postgresServerId.value", code: "not_preview_suggestion" },
    ]);
  });

  test("a stated server is refused too, whatever the text says", () => {
    const set = { "fields.placement.postgresServerId": stated("pg-b", "Standard plan") };
    expect(errorsOf(set)).toEqual([
      { path: "fields.placement.postgresServerId.value", code: "not_preview_suggestion" },
    ]);
  });

  test("with no suggestion, only absent passes", () => {
    const none = options({
      placementPreview: {
        postgresServerId: { suggested: null, basis: "occupancy_unknown" },
        mongoServerId: { suggested: "local-mongo", basis: "only_candidate" },
        blobAccountId: { suggested: "blob-1", basis: "only_candidate" },
      },
    });
    expect(errorsOf({}, none)).toEqual([
      { path: "fields.placement.postgresServerId.value", code: "not_preview_suggestion" },
    ]);
    expect(errorsOf({ "fields.placement.postgresServerId": absent() }, none)).toEqual([]);
  });
});

describe("never stricter than TM", () => {
  // TM accepts every one of these (spec/rules_test.go), so the plugin must too.
  test.each<[string, Record<string, unknown>]>([
    ["title of 100", { "fields.title.value": long(100) }],
    ["title with an ampersand", { "fields.title.value": "Johnson & Johnson" }],
    ["company name that is a domain", { "fields.title.value": "Naukri.com" }],
    ["abbreviation with a dot", { "fields.title.value": "Acme Pvt. Ltd/India" }],
    ["label that ends like a scheme", { "fields.title.value": "Hotel: Grand Profile: Acme" }],
    ["title in Tamil", { "fields.title.value": "அகரம் கல்வி நிறுவனம்" }],
    ["summary in Tamil", { summary: "வணக்கம்" }],
    ["summary with an emoji", { summary: `Great ${cps(0x2764, 0xfe0f)}` }],
    ["summary with a keycap", { summary: `Press ${cps(0x31, 0xfe0f, 0x20e3)}` }],
    ["budget of 0", { "fields.subscription.monthlyBudget": stated(0) }],
    ["budget of 1,000,000", { "fields.subscription.monthlyBudget": stated(1000000) }],
    ["budget of 0.29", { "fields.subscription.monthlyBudget": stated(0.29) }],
    ["confidence of 0.5", { "fields.title.confidence": 0.5 }],
    ["default languages follow the stated default", {
      "fields.defaultLang.value": "ta",
      "fields.enabledLanguages": { value: ["ta"], source: "default", confidence: 1, evidence: [] },
    }],
    [
      "default option off",
      { "fields.options.groups": { value: false, source: "default", confidence: 1, evidence: [] } },
    ],
    ["theme preset", { "fields.theme": stated("Doom 64") }],
    ["absent placement", { "fields.placement.blobAccountId": absent() }],
    ["a quote with other whitespace", { "fields.title.evidence": ["Acme   Learning\nPvt\tLtd"] }],
    ["a quote with hidden characters", { "fields.title.evidence": ["Acme\u200b Learning\u2066 Pvt Ltd"] }],
    ["a quote of 300", { sourceText: `${SOURCE} ${long(300)}`, "fields.title.evidence": [long(300)] }],
    ["source of 50,000", { sourceText: `${SOURCE} ${long(49999 - SOURCE.length)}` }],
    ["source with CRLF and hidden text", { sourceText: `\u200b${SOURCE.replaceAll("\n", "\r\n")}\r\n\u{e0041}` }],
    ["source of 50,000 with hidden text around it", {
      sourceText: `\u200b${SOURCE} ${long(49999 - SOURCE.length)}\u2066`,
    }],
    ["source of 50,000 once its secret is replaced", {
      sourceText: `${SOURCE}\npassword: abcd ${long(49976 - SOURCE.length)}`,
    }],
    ["lone surrogates in the source and a quote, both U+FFFD for TM", {
      sourceText: `${SOURCE}\nref x\udbffy`,
      "fields.title.evidence": ["Acme Learning Pvt Ltd", "ref x\ud800y"],
    }],
    ["a summary with a lone surrogate", { summary: "Acme \udc00 Learning" }],
    ["a quote spanning a secret", {
      sourceText: `${SOURCE}\nTemp password: Welcome@123 for Priya`,
      "fields.title.evidence": ["Temp password: Welcome@123", "Welcome@123"],
    }],
    ["a URL in the source and a quote", {
      sourceText: `${SOURCE}\nsee https://acme.in/demo`,
      "fields.title.evidence": ["see https://acme.in/demo"],
    }],
    ["a note of 200", { flags: [{ code: "other", field: "", note: long(200) }] }],
    ["20 flags", { flags: Array(20).fill({ code: "non_english", field: "", note: "" }) }],
    ["a flag on a field", { flags: [{ code: "assumed_value", field: "fields.partnerId", note: "" }] }],
  ])("%s", (_, set) => {
    expect(errorsOf(set)).toEqual([]);
  });

  // TM checks these itself, with tables the plugin does not have; the plugin must leave them alone.
  test.each<[string, Record<string, unknown>]>([
    ["tenant key of 2", { "fields.tenantKey.value": "ab" }],
    ["tenant key of 53", { "fields.tenantKey.value": long(53) }],
    ["tenant key a--b", { "fields.tenantKey.value": "a--b" }],
    ["tenant key Acme", { "fields.tenantKey.value": "Acme" }],
    ["tenant key with an underscore", { "fields.tenantKey.value": "acme_learning" }],
    ["reserved tenant key", { "fields.tenantKey.value": "api" }],
    ["company id with a space", { "fields.companyId.value": "RC 4471" }],
    ["company id of 65", { "fields.companyId.value": long(65) }],
    ["admin user of 2", { "fields.adminUserName.value": "ab" }],
    ["email with two dots", { "fields.adminEmail.value": "a..b@acme.in" }],
    ["email without a dot in the domain", { "fields.adminEmail.value": "a@acme" }],
    ["email with a display name", { "fields.adminEmail.value": "Priya N <priya.n@acmelearning.in>" }],
    ["email with an upper-case domain", { "fields.statedRequesterEmail.value": "priya@ACME.in" }],
    ["quoted local part", { "fields.adminEmail.value": "\"a b\"@acme.in" }],
    ["Mars/Base", { "fields.timeZone.value": "Mars/Base" }],
    ["Local", { "fields.timeZone.value": "Local" }],
    ["lower-case utc", { "fields.timeZone.value": "utc" }],
    ["zone with a space", { "fields.timeZone.value": "Asia/Kolkata " }],
    ["zone path traversal", { "fields.timeZone.value": "../../etc/passwd" }],
    ["tenant key with a tab, which is not hidden", { "fields.tenantKey.value": "acme\tlearning" }],
    [
      "company id with a keycap, whose selector is not hidden",
      { "fields.companyId.value": `RC-4471${cps(0x23, 0xfe0f, 0x20e3)}` },
    ],
    ["tenant key with a lone surrogate", { "fields.tenantKey.value": "acme\ud800" }],
    ["email with a non-breaking space", { "fields.adminEmail.value": "priya\u00a0n@acme.in" }],
    ["email with a Cyrillic letter", { "fields.adminEmail.value": "priya.n@\u0430cme.in" }],
  ])("leaves %s to TM", (_, set) => {
    expect(errorsOf(set)).toEqual([]);
  });
});

describe("decimals", () => {
  // TM's decimals uses strconv.FormatFloat(f, 'f', -1, 64); JavaScript prints small and large numbers in exponent form.
  test.each([
    [0, 0],
    [1, 0],
    [0.29, 2],
    [0.955, 3],
    [0.1 + 0.2, 17],
    [1e-7, 7],
    [1.5e-7, 8],
    [1e21, 0],
    [1.25e21, 0],
    [123456.78, 2],
    [-0.05, 2],
  ])("%d has %d", (x, n) => {
    expect(decimals(x)).toBe(n);
  });
});
