// Talks to Tenant Manager as a scoped agent key and checks the key holds nothing beyond the agent's allowed access.
// Neither the key nor the token it is exchanged for may ever appear in a returned value, an error message or a log.
import { readFileSync } from "node:fs";

export const KEY_PATTERN = /^tmk_([0-9a-f]{16})_[A-Za-z0-9_-]{43}$/;

// The only permissions the agent may hold. provisioning.* and ops.view are planned but not yet defined in TM.
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  "plans.view",
  "partners.view",
  "provisioning.view",
  "provisioning.submit",
  "ops.view",
]);

const REQUEST_TIMEOUT_MS = 15_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export type IdentityErrorCode = "config" | "rejected" | "rate_limited" | "no_access" | "unavailable" | "refused";

export class IdentityError extends Error {
  constructor(
    readonly code: IdentityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IdentityError";
  }
}

export interface Scope {
  allTenants: boolean;
  tenants: string[];
  partners: string[];
}

export interface Identity {
  keyId: string;
  keyName: string;
  permissions: string[];
  grants: { permissions: string[]; scope: Scope }[];
  tokenExpiresAt: string;
}

export interface TMConfig {
  baseUrl: URL;
  key: string;
  keyId: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): TMConfig {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new IdentityError("config", "NODE_TLS_REJECT_UNAUTHORIZED=0 turns off certificate checks; unset it before sending the key");
  }
  const rawUrl = env.TM_BASE_URL?.trim();
  if (!rawUrl) {
    throw new IdentityError("config", "TM_BASE_URL is not set");
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawUrl.endsWith("/") ? rawUrl : `${rawUrl}/`);
  } catch {
    throw new IdentityError("config", "TM_BASE_URL is not a valid URL");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname);
  if (baseUrl.protocol !== "https:" && !(local && baseUrl.protocol === "http:")) {
    throw new IdentityError("config", "TM_BASE_URL must use https (plain http is allowed only for localhost)");
  }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new IdentityError("config", "TM_BASE_URL must not carry credentials, a query or a fragment");
  }
  const key = readKey(env);
  const match = KEY_PATTERN.exec(key);
  if (!match?.[1]) {
    throw new IdentityError("config", "TM_AGENT_KEY (or TM_AGENT_KEY_FILE) is not set or is not a Tenant Manager agent key");
  }
  return { baseUrl, key, keyId: match[1] };
}

// readKey prefers TM_AGENT_KEY_FILE, so a runner can keep the secret out of the environment every process inherits.
function readKey(env: NodeJS.ProcessEnv): string {
  const file = env.TM_AGENT_KEY_FILE?.trim();
  if (!file) {
    return env.TM_AGENT_KEY?.trim() ?? "";
  }
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    throw new IdentityError("config", "TM_AGENT_KEY_FILE could not be read");
  }
}

type Fetch = typeof fetch;

export class TMClient {
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly config: TMConfig,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async identity(): Promise<Identity> {
    const me = await this.getJSON("api/tenantmanagements/me");
    return checkIdentity(me, this.config.keyId, new Date(this.token?.expiresAt ?? this.now()).toISOString());
  }

  private async getJSON(path: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.send(path, { headers: { Authorization: `Bearer ${await this.accessToken()}` } });
      if (res.status === 401 && attempt === 0) {
        this.token = undefined;
        continue;
      }
      if (!res.ok) {
        throw await statusError(res, "Tenant Manager refused the request");
      }
      return res.json();
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.token.value;
    }
    const res = await this.send("api/tm/auth/agent-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: this.config.key }),
    });
    if (!res.ok) {
      throw await statusError(res, "Tenant Manager did not issue a token for the agent key");
    }
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
      throw new IdentityError("unavailable", "Tenant Manager returned an unexpected token response");
    }
    this.token = { value: body.access_token, expiresAt: this.now() + body.expires_in * 1000 };
    return this.token.value;
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(new URL(path, this.config.baseUrl), {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new IdentityError("unavailable", `could not reach Tenant Manager at ${this.config.baseUrl.origin}`);
    }
  }
}

// statusError names the likely cause and quotes TM's own reason. TM answers errors with short fixed strings, never
// secrets; the quote is still trimmed to printable ASCII and capped, since it reaches the model.
async function statusError(res: Response, context: string): Promise<IdentityError> {
  const reason = (await res.text().catch(() => "")).replace(/[^\x20-\x7e]+/g, " ").trim().slice(0, 100);
  const said = `HTTP ${res.status}${reason ? ` "${reason}"` : ""}`;
  switch (res.status) {
    case 401:
      return new IdentityError("rejected", `${context} (${said}): the key is invalid, expired, revoked or not allowed from this address`);
    case 403:
      return new IdentityError("no_access", `${context} (${said}): the key has no effective access, or TM is not set up for agents`);
    case 429: {
      const retry = Number(res.headers.get("Retry-After"));
      const wait = Number.isInteger(retry) && retry > 0 ? `; retry after ${retry}s` : "";
      return new IdentityError("rate_limited", `${context} (${said}): rate limited${wait}`);
    }
    default:
      return new IdentityError("unavailable", `${context} (${said})`);
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function scope(value: unknown): Scope {
  const s = (value ?? {}) as Record<string, unknown>;
  return { allTenants: s.allTenants === true, tenants: strings(s.tenants), partners: strings(s.partners) };
}

// checkIdentity refuses a /me response that is not this key, is a super admin, or holds any permission outside the
// allowed set - in the union or in any single grant.
export function checkIdentity(me: unknown, keyId: string, tokenExpiresAt: string): Identity {
  const body = (me ?? {}) as Record<string, unknown>;
  const expected = `key:${keyId}`;
  if (body.email !== expected || body.oid !== expected) {
    throw new IdentityError("refused", "Tenant Manager identified the token as someone other than the configured agent key");
  }
  const access = (body.access ?? {}) as Record<string, unknown>;
  if (access.superAdmin !== false) {
    throw new IdentityError("refused", "the agent key reports super-admin access, which an agent must never have");
  }
  const grants = Array.isArray(access.grants)
    ? access.grants.map((g) => {
        const grant = (g ?? {}) as Record<string, unknown>;
        return { permissions: strings(grant.permissions), scope: scope(grant.scope) };
      })
    : [];
  const held = new Set([...strings(access.permissions), ...grants.flatMap((g) => g.permissions)]);
  if (held.size === 0) {
    throw new IdentityError("no_access", "the agent key holds no permissions");
  }
  const extra = [...held].filter((p) => !ALLOWED_PERMISSIONS.has(p)).sort();
  if (extra.length > 0) {
    throw new IdentityError("refused", `the agent key holds access an agent must not have: ${extra.join(", ")}`);
  }
  return {
    keyId,
    keyName: typeof body.name === "string" ? body.name.replace(/^key:/, "") : "",
    permissions: [...held].sort(),
    grants,
    tokenExpiresAt,
  };
}
