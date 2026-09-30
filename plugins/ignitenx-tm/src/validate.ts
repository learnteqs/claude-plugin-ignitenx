// The plugin's mirror of TM's spec.Validate (rules.go), with TM's paths and codes, for what the options let it know.
// It must never refuse what TM accepts. Its own rules: a placement must be TM's preview suggestion; the paste must
// still fit once its secrets are replaced, since that is the text TM receives; and no summary, note or value may repeat
// a secret replaced in the paste, which TM never sees.
import type { AgentOptions } from "./options.js";
import {
  FIELD_PATHS,
  FLAGS_NEEDING_NOTE,
  FLAG_CODES,
  MAX_ENABLED_LANGUAGES,
  MAX_FIELD_ERRORS,
  MAX_MONTHLY_BUDGET,
  MIN_STATED_CONFIDENCE,
  STAGES,
  SUMMARY_MAX_CHARS,
  fieldAt,
  type AnyField,
  type FieldPath,
  type FieldValue,
  type SubmitInput,
} from "./spec.js";
import {
  charCount,
  containsHidden,
  containsSecret,
  findQuote,
  normalizeText,
  redact,
  redactedTexts,
  textCode,
} from "./text.js";
import type { FieldError } from "./tm-client.js";

type Fields = SubmitInput["fields"];
type Kind = keyof AgentOptions["placementPreview"];

interface Rule {
  check?: (o: AgentOptions, value: FieldValue) => string;
  defaultValue?: (o: AgentOptions, f: Fields) => FieldValue;
  chosen?: (o: AgentOptions) => boolean;
}

const textRule = (maxChars: number) => (_: AgentOptions, v: FieldValue) => textCode(v as string, maxChars);

const listRule = (allowed: (o: AgentOptions) => string[]) => (o: AgentOptions, v: FieldValue) =>
  allowed(o).includes(v as string) ? "" : "not_in_options";

// Tenant key, company id, admin user name, the emails and the time zone are left to TM, which has the tables they need.
// TM's formats for them are ASCII, so none allows a character TM's freeText calls hidden; only that is refused here,
// with TM's code.
const hiddenRule = (code: string) => (_: AgentOptions, v: FieldValue) => (containsHidden(v as string) ? code : "");

const always = () => true;

// A replaced text shorter than this is too likely to be an ordinary part of a value to be looked for.
const MIN_SECRET_CHARS = 4;

const RULES: Record<FieldPath, Rule> = {
  "fields.tenantKey": { check: hiddenRule("invalid_format") },
  "fields.title": { check: textRule(100) },
  "fields.pageTitle": { check: textRule(100) },
  "fields.idpDisplayName": { check: textRule(80) },
  "fields.industry": { check: textRule(60) },
  "fields.partnerId": { chosen: (o) => o.partners.length === 1 },
  "fields.companyId": { check: hiddenRule("invalid_format") },
  "fields.adminUserName": { check: hiddenRule("invalid_format") },
  "fields.adminEmail": { check: hiddenRule("invalid_format") },
  "fields.statedRequesterEmail": { check: hiddenRule("invalid_format") },
  "fields.defaultLang": { check: listRule(languages), defaultValue: (o) => o.defaults.defaultLang },
  "fields.enabledLanguages": {
    check: checkLanguages,
    defaultValue: (o, f) => [f.defaultLang.value ?? o.defaults.defaultLang],
  },
  "fields.timeZone": { check: hiddenRule("invalid_time_zone") },
  "fields.theme": { check: listRule((o) => o.themes), defaultValue: (o) => o.defaults.theme },
  "fields.themeMode": { check: listRule((o) => o.themeModes), defaultValue: (o) => o.defaults.themeMode },
  "fields.requestedEnvironment": { check: textRule(40) },
  "fields.requestedRegion": { check: textRule(40) },
  "fields.options.functionalManager": { defaultValue: (o) => o.defaults.optionFlags },
  "fields.options.groups": { defaultValue: (o) => o.defaults.optionFlags },
  "fields.options.genAI.chatbot": { defaultValue: (o) => o.defaults.optionFlags },
  "fields.options.genAI.aitutor": { defaultValue: (o) => o.defaults.optionFlags },
  "fields.options.genAI.postAssessment": { defaultValue: (o) => o.defaults.optionFlags },
  "fields.subscription.planId": { check: listRule((o) => o.plans.map((p) => p.id)) },
  "fields.subscription.status": {
    check: listRule((o) => o.subscriptionStatuses),
    defaultValue: (o) => o.defaults.subscriptionStatus,
  },
  "fields.subscription.preferredProvider": {
    check: listRule((o) => o.preferredProviders),
    defaultValue: (o) => o.defaults.preferredProvider,
  },
  "fields.subscription.monthlyBudget": { check: checkBudget },
  "fields.placement.postgresServerId": { check: placement("postgres", "postgresServerId"), chosen: always },
  "fields.placement.mongoServerId": { check: placement("mongo", "mongoServerId"), chosen: always },
  "fields.placement.blobAccountId": { check: placement("blob", "blobAccountId"), chosen: always },
};

// validate returns TM's field errors for the input, at most 20, in the order TM reports them.
export function validate(input: SubmitInput, options: AgentOptions): FieldError[] {
  const paste = normalizeText(input.sourceText).text;
  const v = new Validator(options, input.fields, pastedSecrets(paste, options.limits.sourceTextMaxChars));
  v.text("summary", input.summary, SUMMARY_MAX_CHARS);
  const source = v.sourceText(paste);
  const notRequest = v.triage(input.triage);
  for (const path of FIELD_PATHS) {
    v.field(path, fieldAt(input.fields, path), source, notRequest);
  }
  v.crossFields(notRequest);
  v.flags(input.flags);
  return v.errs;
}

class Validator {
  readonly errs: FieldError[] = [];

  constructor(
    private readonly opts: AgentOptions,
    private readonly fields: Fields,
    private readonly secrets: string[],
  ) {}

  fail(path: string, code: string): void {
    if (this.errs.length < MAX_FIELD_ERRORS) {
      this.errs.push({ path, code });
    }
  }

  // sourceText takes the normalised paste, and returns it for quotes to be looked up in, or undefined when TM would
  // refuse it.
  sourceText(text: string): string | undefined {
    const max = this.opts.limits.sourceTextMaxChars;
    if (text === "") {
      this.fail("sourceText", "source_empty");
      return undefined;
    }
    if (charCount(text) > max) {
      this.fail("sourceText", "source_too_long");
      return undefined;
    }
    if (charCount(redact(text).text) > max) {
      this.fail("sourceText", "source_too_long_after_redaction");
    }
    return text;
  }

  // triage reports whether the model said this is not a tenant request.
  triage(t: SubmitInput["triage"]): boolean {
    this.confidence("triage.confidence", t.confidence);
    if (!(STAGES as readonly string[]).includes(t.stage)) {
      this.fail("triage.stage", "not_in_options");
    } else if (t.isTenantRequest === (t.stage === "not_a_request")) {
      this.fail("triage.stage", "triage_inconsistent");
    }
    return !t.isTenantRequest;
  }

  field(path: FieldPath, f: AnyField, source: string | undefined, notRequest: boolean): void {
    if (notRequest && f.source !== "absent") {
      this.fail(path, "triage_inconsistent");
      return;
    }
    const rule = RULES[path];
    this.fieldSource(path, f, rule);
    this.confidence(`${path}.confidence`, f.confidence);
    this.evidence(`${path}.evidence`, f.evidence, source);
    if (f.value !== null) {
      this.value(`${path}.value`, f.value, rule);
    }
  }

  private fieldSource(path: string, f: AnyField, rule: Rule): void {
    const quotes = f.evidence.length;
    switch (f.source) {
      case "stated":
      case "derived":
        if (f.value === null) {
          this.fail(`${path}.value`, "value_required");
        }
        if (quotes === 0) {
          this.fail(`${path}.evidence`, "evidence_required");
        }
        if (f.confidence < MIN_STATED_CONFIDENCE) {
          this.fail(`${path}.confidence`, "confidence_band");
        }
        break;
      case "default":
        if (!rule.defaultValue) {
          this.fail(`${path}.source`, "source_not_allowed");
          return;
        }
        if (!equalValue(f.value, rule.defaultValue(this.opts, this.fields))) {
          this.fail(`${path}.value`, "not_default");
        }
        if (f.confidence !== 1) {
          this.fail(`${path}.confidence`, "confidence_band");
        }
        break;
      case "chosen":
        if (!rule.chosen?.(this.opts)) {
          this.fail(`${path}.source`, "source_not_allowed");
          return;
        }
        if (f.value === null) {
          this.fail(`${path}.value`, "value_required");
        }
        if (f.confidence <= 0) {
          this.fail(`${path}.confidence`, "confidence_band");
        }
        break;
      case "absent":
        if (f.value !== null) {
          this.fail(`${path}.value`, "value_not_null");
        }
        if (f.confidence !== 0) {
          this.fail(`${path}.confidence`, "confidence_band");
        }
        break;
      default:
        this.fail(`${path}.source`, "bad_source");
        return;
    }
    if (quotes > 0 && f.source !== "stated" && f.source !== "derived") {
      this.fail(`${path}.evidence`, "evidence_not_allowed");
    }
  }

  private confidence(path: string, c: number): void {
    if (c < 0 || c > 1) {
      this.fail(path, "out_of_range");
    } else if (decimals(c) > 2) {
      this.fail(path, "too_precise");
    }
  }

  // Quotes are looked up in the normalised text before redaction, as the model saw it.
  private evidence(path: string, quotes: string[], source: string | undefined): void {
    const limits = this.opts.limits;
    if (quotes.length > limits.quotesPerField) {
      this.fail(path, "too_many_quotes");
      return;
    }
    quotes.forEach((q, i) => {
      const quote = normalizeText(q).text;
      if (quote === "" || charCount(quote) > limits.quoteMaxChars) {
        this.fail(`${path}[${i}]`, "quote_length");
      } else if (source !== undefined && findQuote(source, quote) === null) {
        this.fail(`${path}[${i}]`, "evidence_not_in_source");
      }
    });
  }

  private value(path: string, value: FieldValue, rule: Rule): void {
    const texts = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
    if (texts.some((t) => this.secret(t))) {
      this.fail(path, "secret_in_value");
      return;
    }
    const code = rule.check?.(this.opts, value) ?? "";
    if (code !== "") {
      this.fail(path, code);
    }
  }

  crossFields(notRequest: boolean): void {
    const lang = this.fields.defaultLang.value;
    const langs = this.fields.enabledLanguages.value;
    if (lang !== null && langs !== null && !langs.includes(lang)) {
      this.fail("fields.enabledLanguages.value", "default_lang_not_enabled");
    }
    const partner = this.fields.partnerId.value;
    const missing = !notRequest && this.opts.partnerRequired && partner === null;
    if (missing || (partner !== null && !this.opts.partners.some((p) => p.id === partner))) {
      this.fail("fields.partnerId", "partner_not_allowed");
    }
  }

  flags(flags: SubmitInput["flags"]): void {
    if (flags.length > this.opts.limits.flagsMax) {
      this.fail("flags", "too_many_flags");
      return;
    }
    flags.forEach((f, i) => {
      const path = `flags[${i}]`;
      if (!(FLAG_CODES as readonly string[]).includes(f.code)) {
        this.fail(`${path}.code`, "unknown_flag");
      }
      if (f.field !== "" && !(FIELD_PATHS as readonly string[]).includes(f.field)) {
        this.fail(`${path}.field`, "unknown_field_path");
      }
      if (f.note !== "") {
        this.text(`${path}.note`, f.note, this.opts.limits.noteMaxChars);
      } else if (FLAGS_NEEDING_NOTE.has(f.code)) {
        this.fail(`${path}.note`, "note_required");
      }
    });
  }

  text(path: string, s: string, maxChars: number): void {
    if (this.secret(s)) {
      this.fail(path, "secret_in_value");
      return;
    }
    const code = textCode(s, maxChars);
    if (code !== "") {
      this.fail(path, code);
    }
  }

  // secret is TM's check for a secret, plus the plugin's own: s, once normalised, holds a text the paste's redaction
  // replaced, such as a password that only its label in the paste showed to be one.
  private secret(s: string): boolean {
    if (containsSecret(s)) {
      return true;
    }
    const text = this.secrets.length > 0 ? normalizeText(s).text : "";
    return this.secrets.some((secret) => text.includes(secret));
  }
}

// pastedSecrets is what the redaction of the normalised paste hides from TM, for a paste TM would take. Each is also
// kept without the punctuation around it, which the model drops when it repeats a secret.
function pastedSecrets(paste: string, maxChars: number): string[] {
  if (paste === "" || charCount(paste) > maxChars) {
    return [];
  }
  const sent = redact(paste).text;
  const out = new Set<string>();
  for (const text of redactedTexts(paste)) {
    for (const secret of [text, text.replace(EDGE_PUNCTUATION, "")]) {
      if (charCount(secret) >= MIN_SECRET_CHARS && !sent.includes(secret)) {
        out.add(secret);
      }
    }
  }
  return [...out];
}

const EDGE_PUNCTUATION = /^["'`*_()[\]{}<>.,;:!?]+|["'`*_()[\]{}<>.,;:!?]+$/g;

function languages(o: AgentOptions): string[] {
  return o.languages.map((l) => l.code);
}

function checkLanguages(o: AgentOptions, value: FieldValue): string {
  const langs = value as string[];
  if (langs.length < 1 || langs.length > MAX_ENABLED_LANGUAGES) {
    return "length";
  }
  const offered = languages(o);
  const seen = new Set<string>();
  for (const l of langs) {
    if (seen.has(l)) {
      return "duplicate";
    }
    seen.add(l);
    if (!offered.includes(l)) {
      return "not_in_options";
    }
  }
  return "";
}

function checkBudget(_: AgentOptions, value: FieldValue): string {
  const b = value as number;
  if (b < 0 || b > MAX_MONTHLY_BUDGET) {
    return "out_of_range";
  }
  return decimals(b) > 2 ? "too_precise" : "";
}

// placement is TM's registry rule plus the plugin's own: the value must be the preview's suggestion.
function placement(servers: keyof AgentOptions["servers"], kind: Kind) {
  return (o: AgentOptions, value: FieldValue): string => {
    if (!o.servers[servers].some((s) => s.id === value)) {
      return "unknown_server";
    }
    return value === o.placementPreview[kind].suggested ? "" : "not_preview_suggestion";
  };
}

// decimals counts the digits after the point in the shortest form that reads back as x, as TM's decimals does.
export function decimals(x: number): number {
  const m = /^\d+(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(Math.abs(x)));
  return m ? Math.max(0, (m[1]?.length ?? 0) - Number(m[2] ?? 0)) : 0;
}

function equalValue(a: FieldValue, b: FieldValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}
