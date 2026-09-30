// HTTP to Tenant Manager as the agent key. Every new token passes /me and checkIdentity before any other call may use
// it, so an over-privileged key reaches no other route. Messages are fixed text: never the key, the token or TM's text.
import {
  IdentityError,
  TMError,
  checkIdentity,
  type FieldError,
  type Identity,
  type IdentityErrorCode,
  type TMConfig,
  type TMErrorCode,
} from "./identity.js";

export { TMError, type FieldError, type TMErrorCode, type TMErrorDetail } from "./identity.js";

const REQUEST_TIMEOUT_MS = 15_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const TOKEN_PATH = "api/tm/auth/agent-token";
const ME_PATH = "api/tenantmanagements/me";
const MAX_FIELD_ERRORS = 20;
const CODE_PATTERN = /^[a-z_]{1,40}$/;
const FIELD_PATH_PATTERN = /^[A-Za-z0-9.\[\]]{1,60}$/;

// Connection failures that prove a request never left this process.
const NOT_SENT: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const EXPLAIN: Record<TMErrorCode, string> = {
  config: "the plugin is not configured correctly",
  rejected: "the key is invalid, expired, revoked or not allowed from this address",
  rate_limited: "rate limited",
  no_access: "the key has no access to this, or TM is not set up for agents",
  unavailable: "Tenant Manager is unavailable",
  refused: "the agent key is refused",
  invalid_spec: "the request has invalid fields",
  conflict: "this request id was already used for a different request",
  too_large: "the request is too large",
  daily_cap: "the daily limit of provisioning requests is reached",
  retry_later: "Tenant Manager is busy; retry the same request",
  bad_request: "Tenant Manager could not read the request",
  ambiguous: "the request may or may not have been recorded",
};

// Retry-After is kept only where the caller may wait and resend.
const WAITS: ReadonlySet<TMErrorCode> = new Set(["rate_limited", "retry_later", "ambiguous"]);

// auth is the token exchange and /me, which are never ambiguous; post is the one call that may have changed state.
type Phase = "auth" | "get" | "post";

interface Session {
  token: string;
  expiresAt: number;
}

export class TMClient {
  // Only ever a token that /me and checkIdentity have passed.
  private session?: Session;

  constructor(
    private readonly config: TMConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async identity(): Promise<Identity> {
    return (await this.verify()).identity;
  }

  async getJSON(path: string): Promise<unknown> {
    const res = await this.authorised(path);
    if (!res.ok) {
      throw await requestError(res, "get");
    }
    return readJSON(res, "get");
  }

  // postJSON returns only a 2xx answer; anything else throws.
  async postJSON(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    const res = await this.authorised(path, JSON.stringify(body));
    if (!res.ok) {
      throw await requestError(res, "post");
    }
    return { status: res.status, body: await readJSON(res, "post") };
  }

  // verify runs /me and checkIdentity on the current token, or on a newly exchanged one, re-exchanging once on a 401.
  private async verify(): Promise<{ identity: Identity; session: Session }> {
    for (let attempt = 0; ; attempt++) {
      const session = this.current() ?? (await this.exchange());
      this.session = undefined;
      const headers = { Authorization: `Bearer ${session.token}` };
      const res = await this.send(this.resolve(ME_PATH), { headers }, "auth");
      if (res.status === 401 && attempt === 0) {
        continue;
      }
      if (!res.ok) {
        throw await authError(res, "Tenant Manager refused the identity check");
      }
      const expires = new Date(session.expiresAt).toISOString();
      const identity = checkIdentity(await readJSON(res, "auth"), this.config.keyId, expires);
      this.session = session;
      return { identity, session };
    }
  }

  // authorised sends with a verified token. A 401 drops it once, and the retry verifies a new token first.
  private async authorised(path: string, body?: string): Promise<Response> {
    const url = this.resolve(path);
    const phase: Phase = body === undefined ? "get" : "post";
    for (let attempt = 0; ; attempt++) {
      const { token } = this.current() ?? (await this.verify()).session;
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      const res = await this.send(url, { method: body === undefined ? "GET" : "POST", headers, body }, phase);
      if (res.status !== 401 || attempt > 0) {
        return res;
      }
      this.session = undefined;
    }
  }

  private current(): Session | undefined {
    return this.session && this.now() < this.session.expiresAt - TOKEN_REFRESH_MARGIN_MS ? this.session : undefined;
  }

  private async exchange(): Promise<Session> {
    const headers = { "Content-Type": "application/json" };
    const body = JSON.stringify({ key: this.config.key });
    const res = await this.send(this.resolve(TOKEN_PATH), { method: "POST", headers, body }, "auth");
    if (!res.ok) {
      throw await authError(res, "Tenant Manager did not issue a token for the agent key");
    }
    const issued = (await readJSON(res, "auth")) as { access_token?: unknown; expires_in?: unknown } | null;
    if (typeof issued?.access_token !== "string" || typeof issued.expires_in !== "number") {
      throw new IdentityError("unavailable", "Tenant Manager returned an unexpected token response");
    }
    return { token: issued.access_token, expiresAt: this.now() + issued.expires_in * 1000 };
  }

  // resolve keeps every request, and so the key and token, under TM_BASE_URL.
  private resolve(path: string): URL {
    const base = this.config.baseUrl;
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw new TMError("config", "refused to send a request outside TM_BASE_URL");
    }
    return url;
  }

  private async send(url: URL, init: RequestInit, phase: Phase): Promise<Response> {
    const base = this.config.baseUrl;
    try {
      return await this.fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      const what = isTimeout(err) ? "did not answer in time" : "could not be reached";
      if (phase === "post" && !NOT_SENT.has(causeCode(err))) {
        const message = `Tenant Manager at ${base.origin} ${what} once the request was sent: ${EXPLAIN.ambiguous}`;
        throw new TMError("ambiguous", message);
      }
      throw unavailable(phase, `Tenant Manager at ${base.origin} ${what}`);
    }
  }
}

function isTimeout(err: unknown): boolean {
  const named = (e: unknown) => e instanceof Error && e.name === "TimeoutError";
  return named(err) || (err instanceof Error && named(err.cause));
}

function causeCode(err: unknown): string {
  const code = (err as { cause?: { code?: unknown } } | undefined)?.cause?.code;
  return typeof code === "string" ? code : "";
}

function unavailable(phase: Phase, message: string): TMError {
  return phase === "auth" ? new IdentityError("unavailable", message) : new TMError("unavailable", message);
}

async function readJSON(res: Response, phase: Phase): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    if (phase === "post") {
      throw new TMError("ambiguous", `the answer to the request could not be read: ${EXPLAIN.ambiguous}`, {
        status: res.status,
      });
    }
    throw unavailable(phase, "Tenant Manager returned an unexpected response");
  }
}

interface ErrorBody {
  tmCode?: string;
  fieldErrors: FieldError[];
}

// readErrorBody keeps only TM's code and the field errors that match their fixed formats; TM's error text is dropped.
async function readErrorBody(res: Response): Promise<ErrorBody> {
  let raw: unknown;
  try {
    raw = JSON.parse(await res.text());
  } catch {
    return { fieldErrors: [] };
  }
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const fieldErrors: FieldError[] = [];
  for (const item of Array.isArray(body.fieldErrors) ? body.fieldErrors : []) {
    const { path, code } = (item ?? {}) as Record<string, unknown>;
    if (matches(path, FIELD_PATH_PATTERN) && matches(code, CODE_PATTERN)) {
      fieldErrors.push({ path, code });
      if (fieldErrors.length === MAX_FIELD_ERRORS) {
        break;
      }
    }
  }
  return matches(body.code, CODE_PATTERN) ? { tmCode: body.code, fieldErrors } : { fieldErrors };
}

function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function retryAfter(res: Response): number | undefined {
  const seconds = Number(res.headers.get("Retry-After") ?? "");
  return Number.isInteger(seconds) && seconds > 0 && seconds <= 86_400 ? seconds : undefined;
}

function statusCode(status: number, tmCode: string | undefined, phase: Phase): TMErrorCode {
  if (status >= 500) {
    if (status === 503 && tmCode === "retry_later") {
      return "retry_later";
    }
    // A 5xx may come after TM stored the request; TM answers "provisioning_unavailable" before it stores anything.
    const beforeStore = status === 503 && tmCode === "provisioning_unavailable";
    return phase === "post" && !beforeStore ? "ambiguous" : "unavailable";
  }
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "rejected";
    case 403:
      return "no_access";
    case 409:
      return "conflict";
    case 413:
      return "too_large";
    case 422:
      return "invalid_spec";
    case 429:
      return tmCode === "daily_cap" ? "daily_cap" : "rate_limited";
    default:
      return "unavailable";
  }
}

function authCode(status: number): IdentityErrorCode {
  switch (status) {
    case 401:
      return "rejected";
    case 403:
      return "no_access";
    case 429:
      return "rate_limited";
    default:
      return "unavailable";
  }
}

function describe(context: string, status: number, code: TMErrorCode, tmCode?: string, wait?: number): string {
  const said = `HTTP ${status}${tmCode ? ` ${tmCode}` : ""}`;
  return `${context} (${said}): ${EXPLAIN[code]}${wait ? `; retry after ${wait}s` : ""}`;
}

async function authError(res: Response, context: string): Promise<IdentityError> {
  const { tmCode } = await readErrorBody(res);
  const code = authCode(res.status);
  const wait = WAITS.has(code) ? retryAfter(res) : undefined;
  return new IdentityError(code, describe(context, res.status, code, tmCode, wait), {
    status: res.status,
    tmCode,
    retryAfterSeconds: wait,
  });
}

async function requestError(res: Response, phase: Phase): Promise<TMError> {
  const { tmCode, fieldErrors } = await readErrorBody(res);
  const code = statusCode(res.status, tmCode, phase);
  const wait = WAITS.has(code) ? retryAfter(res) : undefined;
  return new TMError(code, describe("Tenant Manager refused the request", res.status, code, tmCode, wait), {
    status: res.status,
    tmCode,
    fieldErrors: code === "invalid_spec" ? fieldErrors : [],
    retryAfterSeconds: wait,
  });
}
