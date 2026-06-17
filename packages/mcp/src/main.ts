import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RecordStore } from "@adl/core";
import { buildServer } from "./server.js";

/** Stdio entry point — what Kiro / Q / Cursor launch via mcp.json. */
const DB = process.env.ADL_DB ?? "./out/demo.jsonl";
const store = new RecordStore(DB);
const server = buildServer(store);
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[adr-mcp] governance MCP server running; record=${DB}`);
