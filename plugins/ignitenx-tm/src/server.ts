// tpa-mcp: the only way the ignitenx-tm agent reaches Tenant Manager. The key and token are never logged or returned,
// and every result passes the scrubber on its way to the model.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";

import { loadConfig } from "./identity.js";
import { getInstructions } from "./instructions.js";
import { OptionsCache } from "./options.js";
import { scrub } from "./scrub.js";
import { SubmitInputSchema } from "./spec.js";
import { SubmitError, Submitter } from "./submit.js";
import { TMClient, TMError } from "./tm-client.js";
import { TOOL_NAMES } from "./tool-names.js";

export const SERVER_VERSION = "0.2.0";

const [IDENTITY, OPTIONS, SUBMIT] = TOOL_NAMES;

interface Connection {
  client: TMClient;
  options: OptionsCache;
  submitter: Submitter;
}

export function createServer(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): McpServer {
  const server = new McpServer({ name: "tpa-mcp", version: SERVER_VERSION }, { instructions: getInstructions() });
  // The key and every bearer token sent, which scrub removes even where no secret pattern would find them.
  const secrets = new Set<string>();
  let connection: Connection | undefined;

  const connect = (): Connection => {
    if (!connection) {
      const config = loadConfig(env);
      secrets.add(config.key);
      const client = new TMClient(config, (input, init) => {
        const auth = new Headers(init?.headers).get("Authorization");
        if (auth?.startsWith("Bearer ")) {
          secrets.add(auth.slice("Bearer ".length));
        }
        return fetchImpl(input, init);
      });
      const options = new OptionsCache(client);
      connection = { client, options, submitter: new Submitter({ client, options, env, version: SERVER_VERSION }) };
    }
    return connection;
  };
  const ok = (value: object): CallToolResult => {
    const clean = scrub(value, secrets);
    return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }], structuredContent: { ...clean } };
  };
  const failed = (text: string): CallToolResult => ({
    isError: true,
    content: [{ type: "text", text: scrub(text, secrets) }],
  });

  server.registerTool(
    IDENTITY,
    {
      title: "Get the agent's Tenant Manager identity",
      description:
        "Signs in to Tenant Manager with the configured agent key and returns the key's name, id and permissions. " +
        "Fails, and the agent must stop, if the key holds any access beyond what the provisioning agent is allowed.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return ok(await connect().client.identity());
      } catch (err) {
        return failed(`Identity check failed (${reason(err)}). Stop.`);
      }
    },
  );

  server.registerTool(
    OPTIONS,
    {
      title: "Get Tenant Manager's provisioning options",
      description:
        "Returns what this key may submit: partners, plans, languages, themes, statuses, providers, defaults, " +
        "servers, the placement preview and the limits. Every id or enum in tpa_submit_request must come from this " +
        "result, and a submit needs it to have been read in this session.",
      inputSchema: z.strictObject({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return ok((await connect().options.get()).agent);
      } catch (err) {
        return failed(`Reading the options failed (${reason(err)}). Stop.`);
      }
    },
  );

  server.registerTool(
    SUBMIT,
    {
      title: "Record the pasted tenant request in Tenant Manager",
      description:
        "Records the spec in Tenant Manager as a shadow request for a person to review; nothing is provisioned. " +
        "Call it once per session, after tpa_get_options: every id and enum must come from its result. " +
        "triage.stage is request_ready when the thread settles a request, under_discussion while it is still being " +
        "discussed, and not_a_request exactly when isTenantRequest is false (every field then absent). " +
        "Placement: each fields.placement value is the placementPreview suggestion for that kind, as chosen; when " +
        "the suggestion is null the field is absent and you flag placement_needs_human. Any other server is " +
        "refused. A server the text names never goes in a field, only in the note of a placement_requested_in_text " +
        "flag. An environment or region the text asks for goes in requestedEnvironment or requestedRegion, which " +
        "never decide placement. Secrets in sourceText are redacted before it is sent, and TM strips hidden " +
        "characters; the result counts both. An invalid_spec error lists each rejected field as path: code; fix " +
        "only those and submit again, at most twice. After ambiguous, retry_later or submit_pending, resend the " +
        "same input unchanged or start a new session. Returns the request id, TM's checks, the counts and the " +
        "review link.",
      inputSchema: SubmitInputSchema,
      annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (input) => {
      try {
        return ok(await connect().submitter.submit(input));
      } catch (err) {
        const fields = err instanceof SubmitError && err.code === "invalid_spec" ? err.fieldErrors : [];
        return failed([`Submit failed (${reason(err)}).`, ...fields.map((f) => `${f.path}: ${f.code}`)].join("\n"));
      }
    },
  );
  return server;
}

// reason is an error's code and fixed message; neither ever quotes Tenant Manager or holds a secret.
function reason(err: unknown): string {
  return err instanceof SubmitError || err instanceof TMError ? `${err.code}: ${err.message}` : "unavailable: unexpected error";
}
