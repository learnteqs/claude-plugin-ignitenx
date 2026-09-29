// Maps TM's provisioning options, field by field, into the only view of them the model gets, and keeps the first good
// answer for the life of the process. Whatever else TM sends, such as a server's host or tenant counts, is dropped.
import { printable, printables, sanitise } from "./identity.js";
import { TMError, type TMClient } from "./tm-client.js";

const OPTIONS_PATH = "api/tm/provisioning/options";
const SCHEMA_VERSION = 1;
const OPTIONS_VERSION = /^sha256:[0-9a-f]{64}$/;
const BASIS = /^[a-z_]{1,40}$/;
const MAX_TEXT = 200;
const MAX_ITEMS = 500;
const MAX_LIMIT = 1_000_000;

export interface ServerOption {
  id: string;
  name: string;
  environmentMatch: boolean | null;
}

export interface Suggestion {
  suggested: string | null;
  basis: string;
}

export interface AgentOptions {
  schemaVersion: number;
  environment: { name: string; configured: boolean };
  partnerRequired: boolean;
  partners: { id: string; name: string }[];
  plans: { id: string; name: string; type: string; hasGenAI: boolean }[];
  languages: { code: string; label: string }[];
  themes: string[];
  themeModes: string[];
  subscriptionStatuses: string[];
  preferredProviders: string[];
  defaults: {
    defaultLang: string;
    theme: string;
    themeMode: string;
    subscriptionStatus: string;
    preferredProvider: string;
    optionFlags: boolean;
  };
  servers: Record<"postgres" | "mongo" | "blob", ServerOption[]>;
  placementPreview: Record<"postgresServerId" | "mongoServerId" | "blobAccountId", Suggestion>;
  limits: {
    sourceTextMaxChars: number;
    quoteMaxChars: number;
    quotesPerField: number;
    flagsMax: number;
    noteMaxChars: number;
    tenantKey: { min: number; max: number };
  };
}

export interface CachedOptions {
  agent: AgentOptions;
  optionsVersion: string;
}

type Item = Record<string, unknown>;

// mapOptions throws "unavailable" for an answer it cannot trust as a whole, and drops single items without a usable id.
// A bad name is cleaned instead, so the partners and suggestions the model sees are the ones TM checks against.
export function mapOptions(raw: unknown): CachedOptions {
  const o = record(raw);
  if (o?.schemaVersion !== SCHEMA_VERSION) {
    throw malformed("the schema version is not 1");
  }
  if (typeof o.optionsVersion !== "string" || !OPTIONS_VERSION.test(o.optionsVersion)) {
    throw malformed("the options version is missing or malformed");
  }
  const environment = record(o.environment) ?? {};
  const defaults = record(o.defaults) ?? {};
  const listed = record(o.servers) ?? {};
  const servers = {
    postgres: serverList(listed.postgres),
    mongo: serverList(listed.mongo),
    blob: serverList(listed.blob),
  };
  const preview = record(o.placementPreview) ?? {};
  const agent: AgentOptions = {
    schemaVersion: SCHEMA_VERSION,
    environment: { name: label(environment.name, ""), configured: environment.configured === true },
    partnerRequired: o.partnerRequired === true,
    partners: list(o.partners, "id", (p, id) => ({ id, name: label(p.name, id) })),
    plans: list(o.plans, "id", (p, id) => ({
      id,
      name: label(p.name, id),
      type: label(p.type, ""),
      hasGenAI: p.hasGenAI === true,
    })),
    languages: list(o.languages, "code", (l, code) => ({ code, label: label(l.label, code) })),
    themes: values(o.themes),
    themeModes: values(o.themeModes),
    subscriptionStatuses: values(o.subscriptionStatuses),
    preferredProviders: values(o.preferredProviders),
    defaults: {
      defaultLang: id(defaults.defaultLang) ?? "",
      theme: id(defaults.theme) ?? "",
      themeMode: id(defaults.themeMode) ?? "",
      subscriptionStatus: id(defaults.subscriptionStatus) ?? "",
      preferredProvider: id(defaults.preferredProvider) ?? "",
      optionFlags: defaults.optionFlags === true,
    },
    servers,
    placementPreview: {
      postgresServerId: suggestion(preview.postgresServerId, servers.postgres),
      mongoServerId: suggestion(preview.mongoServerId, servers.mongo),
      blobAccountId: suggestion(preview.blobAccountId, servers.blob),
    },
    limits: limits(o.limits),
  };
  return { agent, optionsVersion: o.optionsVersion };
}

// OptionsCache fetches the options once per process; a failed fetch is not kept, so the next call tries again.
export class OptionsCache {
  private cached?: CachedOptions;
  private pending?: Promise<CachedOptions>;

  constructor(private readonly client: Pick<TMClient, "getJSON">) {}

  get(): Promise<CachedOptions> {
    if (this.cached) {
      return Promise.resolve(this.cached);
    }
    this.pending ??= this.client
      .getJSON(OPTIONS_PATH)
      .then(mapOptions)
      .then(
        (options) => (this.cached = options),
        (err: unknown) => {
          this.pending = undefined;
          throw err;
        },
      );
    return this.pending;
  }

  current(): CachedOptions | undefined {
    return this.cached;
  }
}

function malformed(reason: string): TMError {
  return new TMError("unavailable", `Tenant Manager's provisioning options could not be used: ${reason}`);
}

function record(value: unknown): Item | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Item) : undefined;
}

function id(value: unknown): string | undefined {
  return printable(value, MAX_TEXT);
}

// label cleans a name rather than dropping its item, and falls back when nothing printable is left.
function label(value: unknown, fallback: string): string {
  return (typeof value === "string" && sanitise(value, MAX_TEXT)) || fallback;
}

// list keeps the items whose `key` is a usable id; nothing else about an item drops it.
function list<T>(value: unknown, key: string, map: (item: Item, id: string) => T): T[] {
  const out: T[] = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const item = record(raw);
    const itemId = item && id(item[key]);
    if (item && itemId !== undefined) {
      out.push(map(item, itemId));
      if (out.length === MAX_ITEMS) {
        break;
      }
    }
  }
  return out;
}

function values(value: unknown): string[] {
  return printables(value, MAX_ITEMS, MAX_TEXT);
}

function serverList(value: unknown): ServerOption[] {
  return list(value, "id", (s, id) => ({
    id,
    name: label(s.name, id),
    environmentMatch: typeof s.environmentMatch === "boolean" ? s.environmentMatch : null,
  }));
}

// suggestion keeps a suggested id only when it is one of the servers the model is shown.
function suggestion(value: unknown, servers: ServerOption[]): Suggestion {
  const s = record(value) ?? {};
  const suggested = typeof s.suggested === "string" && servers.some((v) => v.id === s.suggested) ? s.suggested : null;
  return { suggested, basis: typeof s.basis === "string" && BASIS.test(s.basis) ? s.basis : "" };
}

function limits(value: unknown): AgentOptions["limits"] {
  const l = record(value) ?? {};
  const key = record(l.tenantKey) ?? {};
  const out = {
    sourceTextMaxChars: limit(l.sourceTextMaxChars),
    quoteMaxChars: limit(l.quoteMaxChars),
    quotesPerField: limit(l.quotesPerField),
    flagsMax: limit(l.flagsMax),
    noteMaxChars: limit(l.noteMaxChars),
    tenantKey: { min: limit(key.min), max: limit(key.max) },
  };
  if (out.tenantKey.min > out.tenantKey.max) {
    throw malformed("the limits are not valid");
  }
  return out;
}

function limit(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw malformed("the limits are not valid");
  }
  return value;
}
