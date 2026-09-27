// Entry point for the bundled server: stdout carries the MCP protocol, so nothing else may be written to it.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "../server.js";

await createServer().connect(new StdioServerTransport());
