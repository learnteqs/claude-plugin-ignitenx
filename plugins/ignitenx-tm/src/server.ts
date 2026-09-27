// tpa-mcp: the only way the ignitenx-tm agent reaches Tenant Manager. The key and token are never logged or returned.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { IdentityError, TMClient, loadConfig } from "./identity.js";

export const SERVER_VERSION = "0.1.0";

export function createServer(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): McpServer {
  const server = new McpServer({ name: "tpa-mcp", version: SERVER_VERSION });
  let client: TMClient | undefined;

  server.registerTool(
    "tpa_get_identity",
    {
      title: "Get the agent's Tenant Manager identity",
      description:
        "Signs in to Tenant Manager with the configured agent key and returns the key's name, id and permissions. " +
        "Fails, and the agent must stop, if the key holds any access beyond what the provisioning agent is allowed.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        client ??= new TMClient(loadConfig(env), fetchImpl);
        const identity = await client.identity();
        return {
          content: [{ type: "text", text: JSON.stringify(identity, null, 2) }],
          structuredContent: { ...identity },
        };
      } catch (err) {
        const message = err instanceof IdentityError ? `${err.code}: ${err.message}` : "unavailable: unexpected error";
        return { isError: true, content: [{ type: "text", text: `Identity check failed (${message}). Stop.` }] };
      }
    },
  );
  return server;
}
