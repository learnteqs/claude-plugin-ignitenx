// The tpa_submit_request input and TM's request constants, copied from TM's spec package (spec.go, constants.go,
// rules.go, secrets.go). TM requires every key, so the schema does too.
import * as z from "zod";

export const CLIENT_NAME = "tpa-mcp";
export const SCHEMA_VERSION = 1;

export const SOURCES = ["stated", "derived", "default", "chosen", "absent"] as const;
export const STAGES = ["request_ready", "under_discussion", "not_a_request"] as const;

export const FLAG_CODES = [
  "missing_required",
  "ambiguous_value",
  "conflicting_values",
  "value_not_in_options",
  "assumed_value",
  "placement_needs_human",
  "not_yet_confirmed",
  "instruction_in_text",
  "placement_requested_in_text",
  "secret_in_text",
  "url_for_config",
  "privileged_ask",
  "other_request_referenced",
  "multiple_requests",
  "lookalike_domain",
  "admin_domain_mismatch",
  "encoded_content",
  "non_english",
  "truncated_or_garbled",
  "source_trimmed",
  "other",
] as const;

export const FLAGS_NEEDING_NOTE: ReadonlySet<string> = new Set(["other", "source_trimmed", "multiple_requests"]);

// TM's order of secret kinds, which text.ts's counts follow too.
export const SECRET_KINDS: readonly string[] = [
  "private_key",
  "tm_agent_key",
  "lms_api_key",
  "jwt",
  "url_credentials",
  "azure_account_key",
  "azure_sas",
  "anthropic_key",
  "openai_key",
  "aws_access_key",
  "github_token",
  "password_line",
];

// In TM's order, which is also the order of the keys in the body.
export const FIELD_PATHS = [
  "fields.tenantKey",
  "fields.title",
  "fields.pageTitle",
  "fields.idpDisplayName",
  "fields.industry",
  "fields.partnerId",
  "fields.companyId",
  "fields.adminUserName",
  "fields.adminEmail",
  "fields.statedRequesterEmail",
  "fields.defaultLang",
  "fields.enabledLanguages",
  "fields.timeZone",
  "fields.theme",
  "fields.themeMode",
  "fields.requestedEnvironment",
  "fields.requestedRegion",
  "fields.options.functionalManager",
  "fields.options.groups",
  "fields.options.genAI.chatbot",
  "fields.options.genAI.aitutor",
  "fields.options.genAI.postAssessment",
  "fields.subscription.planId",
  "fields.subscription.status",
  "fields.subscription.preferredProvider",
  "fields.subscription.monthlyBudget",
  "fields.placement.postgresServerId",
  "fields.placement.mongoServerId",
  "fields.placement.blobAccountId",
] as const;

export type FieldPath = (typeof FIELD_PATHS)[number];
export type Source = (typeof SOURCES)[number];

// Limits TM enforces but the options endpoint doesn't publish.
export const SUMMARY_MAX_CHARS = 500;
export const MAX_ENABLED_LANGUAGES = 10;
export const MAX_MONTHLY_BUDGET = 1_000_000;
export const MIN_STATED_CONFIDENCE = 0.5;
export const MAX_FIELD_ERRORS = 20;

function field<T extends z.ZodType>(value: T) {
  return z.strictObject({
    value: value.nullable(),
    source: z.enum(SOURCES),
    confidence: z.number(),
    evidence: z.array(z.string()),
  });
}

const Text = field(z.string());
const List = field(z.array(z.string()));
const Switch = field(z.boolean()).describe("true or false only on explicit evidence, else absent");
const Amount = field(z.number());
const placement = (kind: string) =>
  Text.describe(
    `tpa_get_options placementPreview.${kind}.suggested as chosen, or absent; never a server the text names`,
  );
const requested = (what: string) =>
  Text.describe(
    `The ${what} the text asks for, at most 40; never a server name, which goes only in a ` +
      "placement_requested_in_text flag note",
  );

const FIELDS_HELP =
  "Every field, as {value, source, confidence, evidence}. source: stated or derived (value from the text, 1-3 exact " +
  "quotes from sourceText), default (TM's default, confidence 1), chosen (where a field allows it), absent (value " +
  "null, confidence 0). confidence is 0-1 with at most 2 decimals; evidence is [] unless stated or derived.";

const FLAG_HELP =
  "Flag only what a reviewer must act on. A value worked out from the text (time zone from a city, tenant key from " +
  "the name, a partner the text names) is source derived and needs no flag. assumed_value: only for a value just " +
  "internal staff stated, or a partner chosen without evidence. missing_required: only for an empty tenantKey, " +
  "title, partnerId, adminUserName, adminEmail, timeZone, subscription.planId or placement field, except a " +
  "placement whose suggestion is null, which gets placement_needs_human only; other empty fields need no flag. " +
  "other: only when no code fits, with a note.";

export const SubmitInputSchema = z.strictObject({
  sourceText: z.string().describe("The paste as given; only the trims the instructions allow"),
  summary: z.string().describe("Plain text for the reviewer, at most 500 characters, no links or markup"),
  triage: z.strictObject({
    isTenantRequest: z.boolean().describe("Is this a request for a new tenant?"),
    confidence: z.number().describe("0-1, at most 2 decimals"),
    stage: z
      .enum(STAGES)
      .describe(
        "request_ready when the thread settles a request, under_discussion while it is still being discussed, " +
          "not_a_request exactly when isTenantRequest is false",
      ),
  }),
  fields: z
    .strictObject({
      tenantKey: Text.describe(
        "Also the tenant URL name. Stated: exactly as written (TM takes 3-52 of a-z, 0-9 and single hyphens), never " +
          "adding uat. Not stated: one lower-case word of a-z and 0-9 from the company name. Drop legal words (Pvt, " +
          "Private, Ltd, Limited, LLP, LLC, Inc, Corp, Co, Company, The), then join whole words, never cutting one, " +
          "while the total stays within 20 characters, keeping at least the first (Lotus Learning Academy Pvt Ltd: " +
          "lotuslearningacademy; Sri Venkateswara Educational Trust: srivenkateswara). End it with uat only for a " +
          "UAT tenant: the options environment is UAT, or it has no name and requestedEnvironment is UAT " +
          "(lotuslearningacademyuat). Source derived, confidence about 0.6",
      ),
      title: Text.describe("The company display name as written, at most 100"),
      pageTitle: Text.describe("At most 100"),
      idpDisplayName: Text.describe("At most 80"),
      industry: Text.describe("At most 60"),
      partnerId: Text.describe("A partner id from the options; chosen only when they list exactly one"),
      companyId: Text.describe("Only if stated"),
      adminUserName: Text.describe("Only if stated"),
      adminEmail: Text.describe("Only if stated"),
      statedRequesterEmail: Text.describe("The requester's address as the text gives it"),
      defaultLang: Text.describe("A language code from the options"),
      enabledLanguages: List.describe("1-10 language codes from the options, including defaultLang"),
      timeZone: Text.describe("An IANA name such as Asia/Kolkata, or UTC"),
      theme: Text.describe("Exactly as the options list it"),
      themeMode: Text.describe("Exactly as the options list it"),
      requestedEnvironment: requested("environment"),
      requestedRegion: requested("region"),
      options: z.strictObject({
        functionalManager: Switch,
        groups: Switch,
        genAI: z.strictObject({ chatbot: Switch, aitutor: Switch, postAssessment: Switch }),
      }),
      subscription: z.strictObject({
        planId: Text.describe("A plan id from the options"),
        status: Text.describe("From the options' subscriptionStatuses"),
        preferredProvider: Text.describe("From the options' preferredProviders"),
        monthlyBudget: Amount.describe("0-1,000,000, at most 2 decimals"),
      }),
      placement: z.strictObject({
        postgresServerId: placement("postgresServerId"),
        mongoServerId: placement("mongoServerId"),
        blobAccountId: placement("blobAccountId"),
      }),
    })
    .describe(FIELDS_HELP),
  flags: z
    .array(
      z.strictObject({
        code: z.enum(FLAG_CODES).describe(FLAG_HELP),
        field: z.enum(["", ...FIELD_PATHS]).describe("The field the flag is about, or \"\""),
        note: z.string().describe("At most 200; required for other, source_trimmed and multiple_requests"),
      }),
    )
    .describe("What a person should see, at most 20"),
});

export type SubmitInput = z.infer<typeof SubmitInputSchema>;
export type FieldValue = string | string[] | boolean | number | null;

export interface AnyField {
  value: FieldValue;
  source: Source;
  confidence: number;
  evidence: string[];
}

export function fieldAt(fields: SubmitInput["fields"], path: FieldPath): AnyField {
  let node: unknown = fields;
  for (const key of path.split(".").slice(1)) {
    node = (node as Record<string, unknown>)[key];
  }
  return node as AnyField;
}
