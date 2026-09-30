import { describe, expect, test, vi } from "vitest";

import { OptionsCache, mapOptions, type AgentOptions } from "../src/options.js";
import { TMError } from "../src/tm-client.js";

const VERSION = `sha256:${"0a".repeat(32)}`;
const THEMES = ["default", "catppuccin", "Doom 64", "sapphire blue", "neon-grove"];

// tmOptions is shaped like TM's buildProvisioningOptions answer, plus canaries that must never reach the model.
function tmOptions(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    optionsVersion: VERSION,
    environment: { name: "development", configured: true, dsn: "postgres://u:CANARY-DSN@canary-db" },
    partnerRequired: true,
    partners: [{ id: "P-102", name: "Repute", password: "CANARY-PW-1" }],
    plans: [
      { id: "plan-std", name: "Standard", type: "standard", hasGenAI: false },
      { id: "plan-pro", name: "Pro", type: "standard", hasGenAI: true, modules: ["GenAI", "CANARY-MODULE"] },
    ],
    languages: [
      { code: "en", label: "English" },
      { code: "ta", label: "தமிழ்" },
    ],
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
      host: "canary-pg.internal",
    },
    servers: {
      postgres: [
        {
          id: "pg-a",
          name: "PG A",
          environmentLabel: "canary-environment-label",
          location: "canary-location",
          environmentMatch: true,
          tenantCount: 7,
          host: "canary-pg.internal",
          password: "CANARY-PW-1",
        },
        { id: "pg-b", name: "PG B", environmentLabel: "uat", location: "local", environmentMatch: false, tenantCount: 2 },
      ],
      mongo: [
        {
          id: "local-mongo",
          name: "Local Mongo",
          environmentLabel: "uat",
          location: "local",
          environmentMatch: null,
          tenantCount: null,
          uri: "mongodb://u:CANARY-MU@canary-mongo.internal",
        },
      ],
      blob: [{ id: "blob-1", name: "Blob", environmentMatch: true, accountKey: "CANARY-AK", accountName: "canaryaccount" }],
    },
    placementPreview: {
      postgresServerId: { suggested: "pg-a", basis: "only_candidate", detail: "CANARY-DETAIL" },
      mongoServerId: { suggested: "local-mongo", basis: "only_candidate" },
      blobAccountId: { suggested: null, basis: "occupancy_unknown" },
      buckets: { uninitialised: 1, staged: 0, unrecorded: 0, blobDefaultAccount: 4, blobUnrecorded: 0, dangling: 0 },
      computedAt: "2026-09-29T10:00:00Z",
    },
    limits: {
      sourceTextMaxChars: 50000,
      quoteMaxChars: 300,
      quotesPerField: 3,
      flagsMax: 20,
      noteMaxChars: 200,
      tenantKey: { min: 3, max: 52 },
      canary: "CANARY-LIMIT",
    },
    host: "canary-pg.internal",
    password: "CANARY-PW-1",
    accountKey: "CANARY-AK",
    dsn: "mongodb://u:CANARY-MU@h",
    nested: { deeper: { secret: "CANARY-NESTED" } },
  };
}

const expected: AgentOptions = {
  schemaVersion: 1,
  environment: { name: "development", configured: true },
  partnerRequired: true,
  partners: [{ id: "P-102", name: "Repute" }],
  plans: [
    { id: "plan-std", name: "Standard", type: "standard", hasGenAI: false },
    { id: "plan-pro", name: "Pro", type: "standard", hasGenAI: true },
  ],
  languages: [
    { code: "en", label: "English" },
    { code: "ta", label: "தமிழ்" },
  ],
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
    postgres: [
      { id: "pg-a", name: "PG A", environmentMatch: true },
      { id: "pg-b", name: "PG B", environmentMatch: false },
    ],
    mongo: [{ id: "local-mongo", name: "Local Mongo", environmentMatch: null }],
    blob: [{ id: "blob-1", name: "Blob", environmentMatch: true }],
  },
  placementPreview: {
    postgresServerId: { suggested: "pg-a", basis: "only_candidate" },
    mongoServerId: { suggested: "local-mongo", basis: "only_candidate" },
    blobAccountId: { suggested: null, basis: "occupancy_unknown" },
  },
  limits: {
    sourceTextMaxChars: 50000,
    quoteMaxChars: 300,
    quotesPerField: 3,
    flagsMax: 20,
    noteMaxChars: 200,
    tenantKey: { min: 3, max: 52 },
  },
};

const withChange = (change: (o: Record<string, any>) => void): Record<string, unknown> => {
  const o = tmOptions();
  change(o);
  return o;
};

const expectUnavailable = (raw: unknown) => {
  let err: unknown;
  try {
    mapOptions(raw);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(TMError);
  expect((err as TMError).code).toBe("unavailable");
  expect((err as TMError).message).not.toMatch(/canary/i);
};

describe("mapOptions", () => {
  test("maps TM's options field by field and drops everything else", () => {
    const { agent, optionsVersion } = mapOptions(tmOptions());
    expect(optionsVersion).toBe(VERSION);
    expect(agent).toEqual(expected);
    expect(Object.keys(agent)).toEqual(Object.keys(expected));
    const shown = JSON.stringify(agent);
    for (const dropped of [/canary/i, /tenantCount/, /environmentLabel/, /location/, /buckets/, /computedAt/, /modules/]) {
      expect(shown).not.toMatch(dropped);
    }
  });

  test.each([
    ["no object", null],
    ["an array", []],
    ["a string", "options"],
    ["schema version 2", withChange((o) => (o.schemaVersion = 2))],
    ["schema version as a string", withChange((o) => (o.schemaVersion = "1"))],
    ["no schema version", withChange((o) => delete o.schemaVersion)],
    ["no options version", withChange((o) => delete o.optionsVersion)],
    ["a short options version", withChange((o) => (o.optionsVersion = "sha256:0a0a"))],
    ["an upper-case options version", withChange((o) => (o.optionsVersion = VERSION.toUpperCase()))],
    ["another hash", withChange((o) => (o.optionsVersion = VERSION.replace("sha256", "md5")))],
    ["a trailing newline", withChange((o) => (o.optionsVersion = `${VERSION}\n`))],
    ["no limits", withChange((o) => delete o.limits)],
    ["a zero limit", withChange((o) => (o.limits.flagsMax = 0))],
    ["a fractional limit", withChange((o) => (o.limits.quoteMaxChars = 300.5))],
    ["a limit as a string", withChange((o) => (o.limits.sourceTextMaxChars = "50000"))],
    ["no tenant key limits", withChange((o) => delete o.limits.tenantKey)],
    ["a tenant key min above its max", withChange((o) => (o.limits.tenantKey = { min: 60, max: 52 }))],
  ])("refuses %s as unavailable", (_name, raw) => {
    expectUnavailable(raw);
  });

  test("drops an item only when its id is unusable", () => {
    const { agent } = mapOptions(
      withChange((o) => {
        o.partners = [
          { id: "P-1", name: "Kept" },
          { id: "p".repeat(200), name: "n".repeat(200) },
          { id: "p".repeat(201), name: "Too long id" },
          { id: "\u{1F600}".repeat(201), name: "Too many code points" },
          { id: "P-8\t", name: "Tab in id" },
          { id: "P-9\u200B", name: "Zero width in id" },
          { id: "P-10\u2029", name: "Paragraph separator in id" },
          { id: "P-11\u{E0041}", name: "Tag in id" },
          { id: "P-12\uD800", name: "Lone surrogate in id" },
          { id: "", name: "Empty id" },
          { id: 9, name: "Number id" },
          { name: "No id" },
          "P-13",
          null,
          { id: "\u{1F600}".repeat(200), name: "Acme Learning தமிழ்" },
        ];
        o.plans = [{ id: "plan\n1", name: "Bad id" }, ...o.plans];
        o.languages = [{ code: "", label: "Empty code" }, { code: "x\u0000", label: "Null in code" }, ...o.languages];
        o.themes = ["default", "", 7, "line\nbreak", "t".repeat(201), "bidi\u202Etheme", "Kodama Grove"];
      }),
    );
    expect(agent.partners).toEqual([
      { id: "P-1", name: "Kept" },
      { id: "p".repeat(200), name: "n".repeat(200) },
      { id: "\u{1F600}".repeat(200), name: "Acme Learning தமிழ்" },
    ]);
    expect(agent.plans.map((p) => p.id)).toEqual(["plan-std", "plan-pro"]);
    expect(agent.languages.map((l) => l.code)).toEqual(["en", "ta"]);
    expect(agent.themes).toEqual(["default", "Kodama Grove"]);
  });

  test("cleans a bad name or label instead of dropping its item, falling back to the id", () => {
    const { agent } = mapOptions(
      withChange((o) => {
        o.environment.name = "develop\u0000ment\u2028";
        o.partners = [
          { id: "P-3", name: "n".repeat(201) },
          { id: "P-4", name: "Bell\u0007" },
          { id: "P-5", name: "Zero\u200Bwidth" },
          { id: "P-6", name: "Bidi\u202Eevil\u202C" },
          { id: "P-7", name: "Two\nlines\r\n" },
          { id: "P-8", name: "Tag\u{E0041}\u{E007F}" },
          { id: "P-9", name: "Half\uD800" },
          { id: "P-10", name: "\u{1F600}".repeat(201) },
          { id: "P-11" },
          { id: "P-12", name: 7 },
          { id: "P-13", name: "\u200B\u2028\u0000" },
          { id: "P-14", name: "" },
        ];
        o.plans = [{ id: "plan-x", name: "No type" }, { id: "plan-y", name: "\u202E", type: "std\u0000" }, ...o.plans];
        o.languages = [{ code: "hi", label: "l".repeat(201) }, { code: "kn" }, ...o.languages];
      }),
    );
    expect(agent.environment.name).toBe("development");
    expect(agent.partners).toEqual([
      { id: "P-3", name: "n".repeat(200) },
      { id: "P-4", name: "Bell" },
      { id: "P-5", name: "Zerowidth" },
      { id: "P-6", name: "Bidievil" },
      { id: "P-7", name: "Twolines" },
      { id: "P-8", name: "Tag" },
      { id: "P-9", name: "Half" },
      { id: "P-10", name: "\u{1F600}".repeat(200) },
      { id: "P-11", name: "P-11" },
      { id: "P-12", name: "P-12" },
      { id: "P-13", name: "P-13" },
      { id: "P-14", name: "P-14" },
    ]);
    expect(agent.plans.slice(0, 2)).toEqual([
      { id: "plan-x", name: "No type", type: "", hasGenAI: false },
      { id: "plan-y", name: "plan-y", type: "std", hasGenAI: false },
    ]);
    expect(agent.languages.slice(0, 2)).toEqual([
      { code: "hi", label: "l".repeat(200) },
      { code: "kn", label: "kn" },
    ]);
  });

  test("keeps TM's partner count and preview suggestion when only a name is bad", () => {
    const { agent } = mapOptions(
      withChange((o) => {
        o.partners = [{ id: "P-102", name: "Repute\u202E" }];
        o.servers.postgres[0].name = "PG\u0007 A";
        o.servers.mongo[0].name = "\u2028";
      }),
    );
    expect(agent.partners).toEqual([{ id: "P-102", name: "Repute" }]);
    expect(agent.servers.postgres[0]).toEqual({ id: "pg-a", name: "PG A", environmentMatch: true });
    expect(agent.servers.mongo).toEqual([{ id: "local-mongo", name: "local-mongo", environmentMatch: null }]);
    expect(agent.placementPreview.postgresServerId).toEqual({ suggested: "pg-a", basis: "only_candidate" });
    expect(agent.placementPreview.mongoServerId).toEqual({ suggested: "local-mongo", basis: "only_candidate" });
  });

  test("drops a server whose id is unusable, and with it any suggestion of that id", () => {
    const { agent } = mapOptions(
      withChange((o) => {
        o.servers.postgres[0].id = "pg-a\u200B";
        o.placementPreview.postgresServerId = { suggested: "pg-a\u200B", basis: "only_candidate" };
      }),
    );
    expect(agent.servers.postgres.map((s) => s.id)).toEqual(["pg-b"]);
    expect(agent.placementPreview.postgresServerId).toEqual({ suggested: null, basis: "only_candidate" });
  });

  test("caps every list at 500 items", () => {
    const { agent } = mapOptions(
      withChange((o) => {
        o.partners = Array.from({ length: 600 }, (_, i) => ({ id: `P-${i}`, name: `Partner ${i}` }));
        o.themes = Array.from({ length: 600 }, (_, i) => `theme-${i}`);
        o.servers.blob = Array.from({ length: 600 }, (_, i) => ({ id: `blob-${i}`, name: "Blob", environmentMatch: true }));
      }),
    );
    expect(agent.partners).toHaveLength(500);
    expect(agent.partners.at(-1)).toEqual({ id: "P-499", name: "Partner 499" });
    expect(agent.themes).toHaveLength(500);
    expect(agent.servers.blob).toHaveLength(500);
  });

  test("keeps a suggestion only for a listed server, with a well-formed basis", () => {
    const { agent } = mapOptions(
      withChange((o) => {
        o.servers.postgres[0].environmentMatch = "yes";
        o.placementPreview.postgresServerId = { suggested: "prod-pg-2", basis: "fewest_tenants" };
        o.placementPreview.mongoServerId = { suggested: "local-mongo", basis: "Only Candidate" };
        o.placementPreview.blobAccountId = "blob-1";
      }),
    );
    expect(agent.servers.postgres[0]).toEqual({ id: "pg-a", name: "PG A", environmentMatch: null });
    expect(agent.placementPreview).toEqual({
      postgresServerId: { suggested: null, basis: "fewest_tenants" },
      mongoServerId: { suggested: "local-mongo", basis: "" },
      blobAccountId: { suggested: null, basis: "" },
    });
  });

  test("reads missing lists and flags as empty and false, never as allowing more", () => {
    const { agent } = mapOptions(
      withChange((o) => {
        delete o.partners;
        delete o.partnerRequired;
        delete o.environment;
        delete o.servers;
        delete o.placementPreview;
        o.defaults = { optionFlags: "true", theme: 7 };
      }),
    );
    expect(agent.partners).toEqual([]);
    expect(agent.partnerRequired).toBe(false);
    expect(agent.environment).toEqual({ name: "", configured: false });
    expect(agent.servers).toEqual({ postgres: [], mongo: [], blob: [] });
    expect(agent.placementPreview.postgresServerId).toEqual({ suggested: null, basis: "" });
    expect(agent.defaults).toEqual({
      defaultLang: "",
      theme: "",
      themeMode: "",
      subscriptionStatus: "",
      preferredProvider: "",
      optionFlags: false,
    });
  });
});

describe("OptionsCache", () => {
  test("fetches the options once and keeps them for the process", async () => {
    const getJSON = vi.fn(async (_path: string): Promise<unknown> => tmOptions());
    const cache = new OptionsCache({ getJSON });
    expect(cache.current()).toBeUndefined();
    const first = await cache.get();
    const again = await cache.get();
    expect(again).toBe(first);
    expect(cache.current()).toBe(first);
    expect(first.agent).toEqual(expected);
    expect(getJSON).toHaveBeenCalledTimes(1);
    expect(getJSON).toHaveBeenCalledWith("api/tm/provisioning/options");
  });

  test("shares one fetch between callers that ask at the same time", async () => {
    const getJSON = vi.fn(async (_path: string): Promise<unknown> => tmOptions());
    const cache = new OptionsCache({ getJSON });
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(a).toBe(b);
    expect(getJSON).toHaveBeenCalledTimes(1);
  });

  test("does not keep a failed fetch", async () => {
    const getJSON = vi
      .fn(async (_path: string): Promise<unknown> => tmOptions())
      .mockRejectedValueOnce(new TMError("unavailable", "Tenant Manager is unavailable"));
    const cache = new OptionsCache({ getJSON });
    await expect(cache.get()).rejects.toMatchObject({ code: "unavailable" });
    expect(cache.current()).toBeUndefined();
    expect((await cache.get()).optionsVersion).toBe(VERSION);
    expect(getJSON).toHaveBeenCalledTimes(2);
  });

  test("does not keep an answer it could not map", async () => {
    const getJSON = vi
      .fn(async (_path: string): Promise<unknown> => tmOptions())
      .mockResolvedValueOnce({ ...tmOptions(), schemaVersion: 2 });
    const cache = new OptionsCache({ getJSON });
    await expect(cache.get()).rejects.toBeInstanceOf(TMError);
    expect(cache.current()).toBeUndefined();
    expect((await cache.get()).agent).toEqual(expected);
    expect(getJSON).toHaveBeenCalledTimes(2);
  });
});
