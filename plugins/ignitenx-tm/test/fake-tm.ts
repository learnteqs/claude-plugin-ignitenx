// A stand-in Tenant Manager for tests: the agent-token exchange, /me, the provisioning options and request submission,
// shaped like TM's handlers, with per-test behaviour and canaries that must never reach the model.
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export const TEST_KEY_ID = "0123456789abcdef";
export const TEST_KEY = `tmk_${TEST_KEY_ID}_${"Abc-_123".repeat(5)}xyz`;
export const TEST_TOKEN = "header.payload-that-must-never-leak.signature";
export const OPTIONS_VERSION = `sha256:${"0f".repeat(32)}`;
export const AGENT_PERMISSIONS = ["provisioning.submit", "provisioning.view"];

// Values TM holds that the model must never see: in unknown option fields, and in TM's error text.
export const CANARIES = ["canary-pg.internal", "CANARY-PW-1", "CANARY-AK", "CANARY-MU", "CANARY-ERR"];

export interface SubmitReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface FakeTM {
  url: string;
  requests: { method: string; path: string; authorization?: string; body: string }[];
  me: unknown;
  exchangeStatus: number;
  meStatus: number;
  expiresIn: number;
  options: unknown;
  optionsStatus: number;
  // Every body POST /requests received with a valid token, as sent.
  submissions: string[];
  // One reply per submission, in order; once they run out, TM's own answer: 201, a 200 replay or a 409.
  submitReplies: SubmitReply[];
  close(): Promise<void>;
}

export function meFor(permissions: string[], extra: Record<string, unknown> = {}): unknown {
  return {
    email: `key:${TEST_KEY_ID}`,
    oid: `key:${TEST_KEY_ID}`,
    name: "key:provisioning-agent",
    access: {
      superAdmin: false,
      grants: [{ permissions, scope: { allTenants: true, tenants: null, partners: null } }],
      permissions,
      scope: { allTenants: true, tenants: null, partners: null },
      ...extra,
    },
  };
}

// tmOptions is GET /api/tm/provisioning/options as TM's handler writes it, plus the canaries.
export function tmOptions(): Record<string, unknown> {
  const server = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    environmentLabel: "development",
    location: "centralindia",
    environmentMatch: true,
    tenantCount: 3,
    ...extra,
  });
  return {
    schemaVersion: 1,
    optionsVersion: OPTIONS_VERSION,
    environment: { name: "development", configured: true },
    partnerRequired: true,
    partners: [{ id: "P-102", name: "Repute" }],
    plans: [{ id: "plan-std", name: "Standard", type: "standard", hasGenAI: true }],
    languages: [
      { code: "en", label: "English" },
      { code: "ta", label: "Tamil" },
    ],
    themes: ["default", "catppuccin", "Doom 64"],
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
      postgres: [server("local-pg", { host: "canary-pg.internal", password: "CANARY-PW-1" })],
      mongo: [server("local-mongo", { connectionString: "mongodb://u:CANARY-MU@h" })],
      blob: [server("blob-1", { accountKey: "CANARY-AK" })],
    },
    placementPreview: {
      postgresServerId: { suggested: "local-pg", basis: "only_candidate" },
      mongoServerId: { suggested: "local-mongo", basis: "only_candidate" },
      blobAccountId: { suggested: "blob-1", basis: "only_candidate" },
      buckets: { uninitialised: 0, staged: 0, unrecorded: 0, blobDefaultAccount: 0, blobUnrecorded: 0, dangling: 0 },
      computedAt: "2026-09-29T10:00:00Z",
    },
    limits: {
      sourceTextMaxChars: 50000,
      quoteMaxChars: 300,
      quotesPerField: 3,
      flagsMax: 20,
      noteMaxChars: 200,
      tenantKey: { min: 3, max: 52 },
    },
    dsn: "mongodb://u:CANARY-MU@h",
  };
}

// requestInput is TM's contract request without the envelope tpa-mcp adds: a tool input that tmOptions() accepts.
export function requestInput(): Record<string, unknown> {
  const contract = JSON.parse(readFileSync(new URL("./fixtures/request-v1.json", import.meta.url), "utf8"));
  const { clientRequestId, schemaVersion, clientOptionsVersion, client, ...input } = contract as Record<string, unknown>;
  return input;
}

// submitAnswer is TM's provisioningSubmitResponse for a stored request, with a field the plugin must drop.
export function submitAnswer(id: string, replayed = false): Record<string, unknown> {
  return {
    id,
    mode: "shadow",
    status: "recorded",
    readiness: "complete",
    replayed,
    specHash: `sha256:${"ab".repeat(32)}`,
    pagePath: `/provisioning/requests/${id}`,
    checks: [
      { code: "tenant_key_available", result: "pass" },
      { code: "company_id_available", result: "unknown", severity: "warning", reason: "lookup_failed" },
      { code: "secret_scan", result: "fail", severity: "warning", count: 1 },
    ],
    redactions: [],
    snapshot: { host: "canary-pg.internal" },
  };
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

export async function startFakeTM(): Promise<FakeTM> {
  const fake: FakeTM = {
    url: "",
    requests: [],
    me: meFor(["partners.view", "plans.view"]),
    exchangeStatus: 200,
    meStatus: 200,
    expiresIn: 900,
    options: tmOptions(),
    optionsStatus: 200,
    submissions: [],
    submitReplies: [],
    close: async () => undefined,
  };
  const stored = new Map<string, string>();
  const submit = (res: ServerResponse, body: string) => {
    fake.submissions.push(body);
    const reply = fake.submitReplies.shift();
    if (reply) {
      send(res, reply.status, reply.body ?? { error: "refused by the fake TM (CANARY-ERR)" }, reply.headers);
      return;
    }
    const id = `pr-${String((JSON.parse(body) as { clientRequestId?: unknown }).clientRequestId)}`;
    const before = stored.get(id);
    if (before === undefined) {
      stored.set(id, body);
      send(res, 201, submitAnswer(id));
    } else if (before === body) {
      send(res, 200, submitAnswer(id, true));
    } else {
      send(res, 409, { error: "this request id was used for another request (CANARY-ERR)", code: "idempotency_conflict" });
    }
  };
  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }
    fake.requests.push({ method: req.method ?? "", path: req.url ?? "", authorization: req.headers.authorization, body });
    if (req.method === "POST" && req.url === "/api/tm/auth/agent-token") {
      if (fake.exchangeStatus !== 200 || JSON.parse(body || "{}").key !== TEST_KEY) {
        res.writeHead(fake.exchangeStatus === 200 ? 401 : fake.exchangeStatus, { "Retry-After": "7" }).end("invalid agent key\n");
        return;
      }
      send(res, 200, { access_token: TEST_TOKEN, token_type: "Bearer", expires_in: fake.expiresIn });
      return;
    }
    if (req.headers.authorization !== `Bearer ${TEST_TOKEN}`) {
      res.writeHead(401).end("invalid token\n");
      return;
    }
    if (req.method === "GET" && req.url === "/api/tenantmanagements/me") {
      if (fake.meStatus !== 200) {
        res.writeHead(fake.meStatus).end("insufficient permissions\n");
        return;
      }
      send(res, 200, fake.me);
      return;
    }
    if (req.method === "GET" && req.url === "/api/tm/provisioning/options") {
      if (fake.optionsStatus !== 200) {
        send(res, fake.optionsStatus, { error: "provisioning options are unavailable (CANARY-ERR)", code: "options_unavailable" });
        return;
      }
      send(res, 200, fake.options);
      return;
    }
    if (req.method === "POST" && req.url === "/api/tm/provisioning/requests") {
      submit(res, body);
      return;
    }
    res.writeHead(404).end("not found\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fake TM did not bind a port");
  }
  fake.url = `http://127.0.0.1:${address.port}`;
  fake.close = () => new Promise((resolve) => server.close(() => resolve()));
  return fake;
}
