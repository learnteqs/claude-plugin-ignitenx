// A stand-in Tenant Manager for tests: the agent-token exchange and /me, with per-test behaviour.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export const TEST_KEY_ID = "0123456789abcdef";
export const TEST_KEY = `tmk_${TEST_KEY_ID}_${"Abc-_123".repeat(5)}xyz`;
export const TEST_TOKEN = "header.payload-that-must-never-leak.signature";

export interface FakeTM {
  url: string;
  requests: { method: string; path: string; authorization?: string; body: string }[];
  me: unknown;
  exchangeStatus: number;
  meStatus: number;
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

export async function startFakeTM(): Promise<FakeTM> {
  const fake: FakeTM = {
    url: "",
    requests: [],
    me: meFor(["partners.view", "plans.view"]),
    exchangeStatus: 200,
    meStatus: 200,
    close: async () => undefined,
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
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ access_token: TEST_TOKEN, token_type: "Bearer", expires_in: 900 }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/tenantmanagements/me") {
      if (req.headers.authorization !== `Bearer ${TEST_TOKEN}`) {
        res.writeHead(401).end("invalid token\n");
        return;
      }
      if (fake.meStatus !== 200) {
        res.writeHead(fake.meStatus).end("insufficient permissions\n");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(fake.me));
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
