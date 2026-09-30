// tpa_submit_request: checks the spec against this session's options, replaces the secrets in the paste, and records
// it in TM once. The paste keeps its hidden characters, for TM to strip and count. An answer that was lost is resent
// with the same id and body, so TM stores it only once.
import { randomBytes } from "node:crypto";

import type { OptionsCache } from "./options.js";
import { CLIENT_NAME, FIELD_PATHS, SCHEMA_VERSION, SECRET_KINDS, fieldAt, type SubmitInput } from "./spec.js";
import { REDACTED, charCount, findQuote, normalizeText, redact, redactRaw, type Count } from "./text.js";
import { TMError, type FieldError, type TMClient, type TMErrorCode } from "./tm-client.js";
import { validate } from "./validate.js";

const REQUESTS_PATH = "api/tm/provisioning/requests";
const MAX_REJECTIONS = 3;
const RESENDS = 2;
// TM refuses an id more than 15 minutes from its clock, so an id not yet stored is replaced well before that.
const ID_MAX_AGE_MS = 10 * 60_000;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE = /^[a-z_]{1,40}$/;
const MAX_CHECKS = 50;
const MAX_COUNTS = 20;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export interface Check {
  code: string;
  result: string;
  severity?: string;
  reason?: string;
  count?: number;
  fields?: string[];
}

export interface SubmitResult {
  requestId: string;
  mode: string;
  status: string;
  readiness: string;
  replayed: boolean;
  checks: Check[];
  redactions: Count[];
  hiddenCharacters: Count[];
  reviewUrl?: string;
}

export type SubmitErrorCode =
  | TMErrorCode
  | "options_required"
  | "too_many_attempts"
  | "already_submitted"
  | "submit_pending";

const RESEND = "resend it unchanged, or start a new session";

const MESSAGES: Partial<Record<SubmitErrorCode, string>> = {
  options_required: "call tpa_get_options first; a submit uses the options read in this session",
  invalid_spec: "the spec has invalid fields; fix only those fields and submit again",
  too_many_attempts: "Tenant Manager refused the spec 3 times; report it and stop",
  already_submitted: "start a new session for the next request",
  submit_pending: `a previous submit may have been recorded; ${RESEND}`,
};

export class SubmitError extends Error {
  readonly retryAfterSeconds?: number;

  constructor(
    readonly code: SubmitErrorCode,
    readonly fieldErrors: FieldError[] = [],
    message = MESSAGES[code] ?? code,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SubmitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }

  static from(err: TMError, message = err.message): SubmitError {
    return new SubmitError(err.code, err.fieldErrors, message, err.retryAfterSeconds);
  }
}

export interface SubmitterDeps {
  client: Pick<TMClient, "postJSON">;
  options: Pick<OptionsCache, "current">;
  env: NodeJS.ProcessEnv;
  now?: () => number;
  random?: (n: number) => Buffer;
  version: string;
}

export class Submitter {
  private id?: { value: string; at: number };
  // The body of a send whose outcome is unknown; until TM answers it, only this exact body may be sent.
  private pending?: string;
  private done = false;
  private rejections = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: SubmitterDeps) {}

  // submit runs one call at a time, so parallel tool calls cannot record two requests.
  submit(input: SubmitInput): Promise<SubmitResult> {
    const run = this.queue.then(() => this.run(input));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(input: SubmitInput): Promise<SubmitResult> {
    if (this.done) {
      throw new SubmitError("already_submitted");
    }
    if (this.rejections >= MAX_REJECTIONS) {
      throw new SubmitError("too_many_attempts");
    }
    const options = this.deps.options.current();
    if (!options) {
      throw new SubmitError("options_required");
    }
    const refused = (errors: FieldError[]) =>
      this.pending === undefined ? new SubmitError("invalid_spec", errors) : new SubmitError("submit_pending");
    const errors = validate(input, options.agent);
    if (errors.length > 0) {
      throw refused(errors);
    }
    // TM normalises the body's text and finds exactly the normalised paste with its secrets replaced.
    const normalized = normalizeText(input.sourceText);
    const seen = redact(normalized.text).text;
    const replaced = redactRaw(input.sourceText);
    const id = this.requestId();
    const body = {
      clientRequestId: id,
      schemaVersion: SCHEMA_VERSION,
      clientOptionsVersion: options.optionsVersion,
      client: { name: CLIENT_NAME, version: this.deps.version },
      sourceText: replaced.text,
      summary: input.summary,
      triage: {
        isTenantRequest: input.triage.isTenantRequest,
        confidence: input.triage.confidence,
        stage: input.triage.stage,
      },
      fields: bodyFields(input, (q) => sentQuote(seen, q, options.agent.limits.quoteMaxChars)),
      flags: input.flags.map((f) => ({ code: f.code, field: f.field, note: f.note })),
    };
    const json = JSON.stringify(body);
    if (this.pending !== undefined && this.pending !== json) {
      throw new SubmitError("submit_pending");
    }
    const answer = await this.send(body, json);
    return result(answer, id, this.deps.env, { redactions: replaced.redactions, hidden: normalized.stripped });
  }

  private async send(body: unknown, json: string): Promise<unknown> {
    let uncertain = false;
    for (let attempt = 0; ; attempt++) {
      let answer: { status: number; body: unknown };
      try {
        answer = await this.deps.client.postJSON(REQUESTS_PATH, body);
      } catch (caught) {
        const err = caught instanceof TMError ? caught : new TMError("ambiguous", "the submit failed unexpectedly");
        switch (err.code) {
          case "invalid_spec":
            // A 422 means TM stored nothing under this id.
            this.pending = undefined;
            this.rejections++;
            if (err.fieldErrors.some((f) => f.path === "clientRequestId" && f.code === "request_id_clock_skew")) {
              this.id = undefined;
            }
            throw SubmitError.from(err);
          case "conflict":
            this.pending = undefined;
            this.done = true;
            throw SubmitError.from(err);
          case "ambiguous":
          case "retry_later":
            uncertain = true;
            if (attempt < RESENDS) {
              await sleep(Math.min(err.retryAfterSeconds ?? 1, 2) * 1000);
              continue;
            }
        }
        if (uncertain) {
          this.pending = json;
        }
        throw SubmitError.from(err, this.pending === undefined ? err.message : `${err.message}; ${RESEND}`);
      }
      this.pending = undefined;
      this.done = true;
      return answer.body;
    }
  }

  // requestId keeps the id while a send is pending, and otherwise replaces one that is missing or getting old.
  private requestId(): string {
    const now = (this.deps.now ?? Date.now)();
    if (this.pending === undefined && (!this.id || now - this.id.at > ID_MAX_AGE_MS)) {
      this.id = { value: ulid(now, (this.deps.random ?? randomBytes)(10)), at: now };
    }
    return this.id?.value ?? "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ulid is a Crockford ULID: 10 characters of milliseconds, then 16 of the 80 random bits.
function ulid(ms: number, random: Buffer): string {
  let time = "";
  for (let i = 0, t = ms; i < 10; i++, t = Math.floor(t / 32)) {
    time = CROCKFORD.charAt(t % 32) + time;
  }
  let bits = 0n;
  for (const byte of random.subarray(0, 10)) {
    bits = (bits << 8n) | BigInt(byte);
  }
  let rest = "";
  for (let i = 0; i < 16; i++, bits >>= 5n) {
    rest = CROCKFORD.charAt(Number(bits & 31n)) + rest;
  }
  return time + rest;
}

// bodyFields builds every field in TM's key order, whatever order the input had.
function bodyFields(input: SubmitInput, quote: (q: string) => string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of FIELD_PATHS) {
    const f = fieldAt(input.fields, path);
    const keys = path.split(".").slice(1);
    const leaf = keys.pop() ?? "";
    let node = out;
    for (const key of keys) {
      node = (node[key] ??= {}) as Record<string, unknown>;
    }
    node[leaf] = { value: f.value, source: f.source, confidence: f.confidence, evidence: f.evidence.map(quote) };
  }
  return out;
}

// sentQuote is the quote as it may reach TM, which must find it in the redacted text: redacted like the text, or the
// redaction token when it overlapped a secret. The quote as given is left only when the text had nothing to redact.
function sentQuote(source: string, quote: string, maxChars: number): string {
  const q = normalizeText(quote).text;
  const found = (c: string) => charCount(c) <= maxChars && findQuote(source, c) !== null;
  return [redact(q).text, REDACTED, q].find(found) ?? REDACTED;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function code(value: unknown): string {
  return typeof value === "string" && CODE.test(value) ? value : "";
}

// count is a positive count, or 0 for anything else; TM leaves zero counts out.
function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

// result keeps only the fields and formats the model may see from TM's answer, which must be about the id sent, and
// adds what the plugin itself replaced and found hidden.
function result(
  raw: unknown,
  sentId: string,
  env: NodeJS.ProcessEnv,
  local: { redactions: Count[]; hidden: Count[] },
): SubmitResult {
  const b = record(raw);
  const requestId = b.id === `pr-${sentId}` ? b.id : "";
  const out: SubmitResult = {
    requestId,
    mode: code(b.mode),
    status: code(b.status),
    readiness: code(b.readiness),
    replayed: b.replayed === true,
    checks: checks(b.checks),
    redactions: merged(local.redactions, counts(b.redactions)),
    hiddenCharacters: local.hidden,
  };
  const page = requestId !== "" && b.pagePath === `/provisioning/requests/${requestId}`;
  const reviewUrl = page ? link(env.TM_UI_URL, requestId) : "";
  if (reviewUrl) {
    out.reviewUrl = reviewUrl;
  }
  return out;
}

function checks(value: unknown): Check[] {
  const out: Check[] = [];
  for (const item of items(value)) {
    const c = record(item);
    if (!code(c.code) || !code(c.result)) {
      continue;
    }
    const check: Check = { code: code(c.code), result: code(c.result) };
    const [severity, reason, n] = [code(c.severity), code(c.reason), count(c.count)];
    if (severity) {
      check.severity = severity;
    }
    if (reason) {
      check.reason = reason;
    }
    if (n) {
      check.count = n;
    }
    const fields = items(c.fields).filter((f): f is string => (FIELD_PATHS as readonly unknown[]).includes(f));
    if (fields.length > 0) {
      check.fields = fields;
    }
    out.push(check);
    if (out.length === MAX_CHECKS) {
      break;
    }
  }
  return out;
}

function counts(value: unknown): Count[] {
  const out: Count[] = [];
  for (const item of items(value)) {
    const c = record(item);
    const n = count(c.count);
    if (code(c.code) && n) {
      out.push({ code: code(c.code), count: n });
      if (out.length === MAX_COUNTS) {
        break;
      }
    }
  }
  return out;
}

// merged sums the plugin's and TM's counts by kind, in TM's order of kinds; a kind the plugin doesn't know goes last.
function merged(local: Count[], tm: Count[]): Count[] {
  const sums = new Map<string, number>();
  for (const c of [...local, ...tm]) {
    sums.set(c.code, (sums.get(c.code) ?? 0) + c.count);
  }
  const known = SECRET_KINDS.filter((k) => sums.has(k));
  const unknown = [...sums.keys()].filter((k) => !SECRET_KINDS.includes(k));
  return [...known, ...unknown].slice(0, MAX_COUNTS).map((c) => ({ code: c, count: sums.get(c) ?? 0 }));
}

// link builds the review page's address under TM_UI_URL, which must pass the same rules as TM_BASE_URL.
function link(raw: string | undefined, requestId: string): string {
  const value = raw?.trim();
  if (!value) {
    return "";
  }
  let base: URL;
  try {
    base = new URL(value.endsWith("/") ? value : `${value}/`);
  } catch {
    return "";
  }
  const secure = base.protocol === "https:" || (base.protocol === "http:" && LOCAL_HOSTS.includes(base.hostname));
  if (!secure || base.username || base.password || base.search || base.hash) {
    return "";
  }
  return new URL(`provisioning/requests/${requestId}`, base).href;
}
