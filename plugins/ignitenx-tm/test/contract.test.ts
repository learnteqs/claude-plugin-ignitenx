import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { mapOptions } from "../src/options.js";
import { SubmitInputSchema } from "../src/spec.js";
import { Submitter } from "../src/submit.js";

// Byte copy of TM's spec/testdata/contract/request-v1.json; TM pins the same hash, so update both together.
const CONTRACT_URL = new URL("./fixtures/request-v1.json", import.meta.url);
const CONTRACT_SHA256 = "sha256:28e65cfe6e72cd4b8f2c4779b3e96ada0de2d9bbc393ab2f5455c1091d3a0420";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const raw = readFileSync(CONTRACT_URL);
const contract = JSON.parse(raw.toString("utf8")) as Record<string, unknown> & {
  clientRequestId: string;
  clientOptionsVersion: string;
  client: { version: string };
};

// The fixed clock and random bytes that make the contract's clientRequestId.
const digits = (s: string) => [...s].map((c) => CROCKFORD.indexOf(c));
const ms = digits(contract.clientRequestId.slice(0, 10)).reduce((t, d) => t * 32 + d, 0);
const bits = digits(contract.clientRequestId.slice(10)).reduce((b, d) => (b << 5n) | BigInt(d), 0n);
const random = Buffer.from(bits.toString(16).padStart(20, "0"), "hex");

function options() {
  const server = (id: string) => ({ id, name: id, environmentMatch: true });
  return mapOptions({
    schemaVersion: 1,
    optionsVersion: contract.clientOptionsVersion,
    environment: { name: "development", configured: true },
    partnerRequired: true,
    partners: [{ id: "P-102", name: "Repute" }],
    plans: [{ id: "plan-std", name: "Standard", type: "standard", hasGenAI: true }],
    languages: ["en", "ta", "kn", "hi", "ar"].map((code) => ({ code, label: code })),
    themes: ["default"],
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
    servers: { postgres: [server("local-pg")], mongo: [server("local-mongo")], blob: [server("blob-1")] },
    placementPreview: {
      postgresServerId: { suggested: "local-pg", basis: "only_candidate" },
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

// toolInput is what the model sends: the contract without the envelope tpa-mcp adds.
function toolInput(): Record<string, unknown> {
  const { clientRequestId, schemaVersion, clientOptionsVersion, client, ...rest } = structuredClone(contract);
  return rest;
}

// reversed rebuilds every object with its keys in the opposite order.
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reversed);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)]));
  }
  return value;
}

async function sentBody(input: unknown): Promise<string> {
  const bodies: string[] = [];
  const submitter = new Submitter({
    client: {
      postJSON: async (_path, body) => {
        bodies.push(JSON.stringify(body));
        return { status: 201, body: {} };
      },
    },
    options: { current: () => options() },
    env: {},
    now: () => ms,
    random: () => random,
    version: contract.client.version,
  });
  await submitter.submit(SubmitInputSchema.parse(input));
  expect(bodies).toHaveLength(1);
  return bodies[0] ?? "";
}

describe("contract with TM", () => {
  test("the fixture is TM's file, byte for byte", () => {
    expect(`sha256:${createHash("sha256").update(raw).digest("hex")}`).toBe(CONTRACT_SHA256);
  });

  test("a fixed tool input produces exactly TM's contract request", async () => {
    const body = await sentBody(toolInput());
    expect(JSON.parse(body)).toEqual(contract);
    expect(body).toBe(JSON.stringify(contract));
  });

  test("the body keeps TM's key order whatever order the input has", async () => {
    const body = await sentBody(reversed(toolInput()));
    expect(body).toBe(JSON.stringify(contract));
  });
});
