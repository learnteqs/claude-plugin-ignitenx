// The agent key's configuration and identity check, the errors every Tenant Manager call reports, and what counts as
// printable text from TM. The key may hold nothing beyond the agent's allowed access; neither the key nor its token may
// appear in a value, a message or a log.
import { readFileSync } from "node:fs";

export const KEY_PATTERN = /^tmk_([0-9a-f]{16})_[A-Za-z0-9_-]{43}$/;

// The only permissions the agent may hold. provisioning.view and provisioning.submit exist in TM; ops.view is planned
// but not yet defined.
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  "plans.view",
  "partners.view",
  "provisioning.view",
  "provisioning.submit",
  "ops.view",
]);

const PERMISSION_NAME = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const PERMISSION_NAME_MAX = 40;
const PERMISSIONS_NAMED = 10;
const KEY_NAME_MAX = 100;
const GRANTS_MAX = 50;
const SCOPE_ENTRIES_MAX = 200;
const SCOPE_ENTRY_MAX = 100;
// Control, format, private-use, unassigned, surrogate and line or paragraph separator characters.
const UNPRINTABLE = /[\p{C}\p{Zl}\p{Zp}]/gu;

export interface FieldError {
  path: string;
  code: string;
}

export type IdentityErrorCode = "config" | "rejected" | "rate_limited" | "no_access" | "unavailable" | "refused";

export type TMErrorCode =
  | IdentityErrorCode
  | "invalid_spec"
  | "conflict"
  | "too_large"
  | "daily_cap"
  | "retry_later"
  | "bad_request"
  | "ambiguous";

export interface TMErrorDetail {
  status?: number;
  tmCode?: string;
  fieldErrors?: FieldError[];
  retryAfterSeconds?: number;
}

// TMError is defined here rather than in tm-client.ts, which re-exports it, so that this file imports nothing back.
export class TMError extends Error {
  readonly status?: number;
  readonly tmCode?: string;
  readonly fieldErrors: FieldError[];
  readonly retryAfterSeconds?: number;

  constructor(
    readonly code: TMErrorCode,
    message: string,
    detail: TMErrorDetail = {},
  ) {
    super(message);
    this.name = "TMError";
    this.status = detail.status;
    this.tmCode = detail.tmCode;
    this.fieldErrors = detail.fieldErrors ?? [];
    this.retryAfterSeconds = detail.retryAfterSeconds;
  }
}

export class IdentityError extends TMError {
  declare readonly code: IdentityErrorCode;

  constructor(code: IdentityErrorCode, message: string, detail: TMErrorDetail = {}) {
    super(code, message, detail);
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

// printable returns the value when it is 1 to max code points with nothing unprintable in it.
export function printable(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value !== "" && value.search(UNPRINTABLE) < 0 && [...value].length <= max
    ? value
    : undefined;
}

// printables keeps up to maxItems printable strings of at most maxChars code points, dropping any other item.
export function printables(value: unknown, maxItems: number, maxChars: number): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const v = printable(raw, maxChars);
    if (v !== undefined) {
      out.push(v);
      if (out.length === maxItems) {
        break;
      }
    }
  }
  return out;
}

// sanitise strips what is unprintable and keeps at most max code points.
export function sanitise(value: string, max: number): string {
  return [...value.replace(UNPRINTABLE, "")].slice(0, max).join("");
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function scope(value: unknown): Scope {
  const s = (value ?? {}) as Record<string, unknown>;
  return {
    allTenants: s.allTenants === true,
    tenants: printables(s.tenants, SCOPE_ENTRIES_MAX, SCOPE_ENTRY_MAX),
    partners: printables(s.partners, SCOPE_ENTRIES_MAX, SCOPE_ENTRY_MAX),
  };
}

// named lists a few well-formed permission names and only counts the rest, so /me cannot put its text in a message.
function named(permissions: string[]): string {
  const wellFormed = permissions.filter((p) => p.length <= PERMISSION_NAME_MAX && PERMISSION_NAME.test(p)).sort();
  const shown = wellFormed.slice(0, PERMISSIONS_NAMED);
  const more = wellFormed.length - shown.length;
  const bad = permissions.length - wellFormed.length;
  const parts = [
    ...(more > 0 ? [`${more} more`] : []),
    ...(bad > 0 ? [`${bad} unrecognised permission${bad === 1 ? "" : "s"}`] : []),
  ];
  return [shown.join(", "), ...parts].filter(Boolean).join(" and ");
}

// checkIdentity refuses a /me response that is not this key, is a super admin, or holds any permission outside the
// allowed set - in the union or in any single grant, including grants beyond those it returns.
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
  const grants = (Array.isArray(access.grants) ? access.grants : []).map((g) => (g ?? {}) as Record<string, unknown>);
  const held = new Set([...strings(access.permissions), ...grants.flatMap((g) => strings(g.permissions))]);
  if (held.size === 0) {
    throw new IdentityError("no_access", "the agent key holds no permissions");
  }
  const extra = [...held].filter((p) => !ALLOWED_PERMISSIONS.has(p));
  if (extra.length > 0) {
    throw new IdentityError("refused", `the agent key holds access an agent must not have: ${named(extra)}`);
  }
  return {
    keyId,
    keyName: typeof body.name === "string" ? sanitise(body.name.replace(/^key:/, ""), KEY_NAME_MAX) : "",
    permissions: [...held].sort(),
    grants: grants.slice(0, GRANTS_MAX).map((g) => ({ permissions: strings(g.permissions), scope: scope(g.scope) })),
    tokenExpiresAt,
  };
}
