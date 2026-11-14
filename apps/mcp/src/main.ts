import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { outsideAgent } from "./identity.js";
import { backstopMcp } from "./server.js";

const apiUrl = process.env.BACKSTOP_API_URL ?? "http://127.0.0.1:8840";
const agent = outsideAgent(process.env.BACKSTOP_MCP_SEED, process.env.BACKSTOP_MCP_AGENT);
await backstopMcp(apiUrl, agent).connect(new StdioServerTransport());
