import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RecordStore } from "@adl/core";
import { buildServer } from "./server.js";

/**
 * Local (Q-style) MCP client — stands in for "a PM acting through Amazon Q".
 *
 * No Q dependency: a real MCP Client talks to the real governance server over the MCP protocol
 * (an in-process linked transport, so it runs anywhere). The protocol conversation is exactly
 * what the server would see from Q. Runs the upstream PM flow: raise a need, approve the intent
 * with a verifiable identity, and show that an unverified approval is rejected.
 *
 * Run (with the board open on the same ADL_DB): npm run client-demo -w @adl/mcp
 */
const DB = process.env.ADL_DB ?? "./out/demo.jsonl";

function text(res: unknown): string {
  const r = res as { content?: { type: string; text?: string }[] };
  return (r.content ?? []).map((c) => c.text ?? "").join("\n");
}

async function main() {
  const store = new RecordStore(DB);
  const server = buildServer(store);

  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);

  const client = new Client({ name: "pm-via-q (local demo client)", version: "0.1.0" });
  await client.connect(clientT);

  const pm = { subject: "pm@example.com", method: "sso" as const, name: "Pat (PM)" };

  console.log("PM raises a market need (as if from Amazon Q)...");
  const raised = await client.callTool({
    name: "raise_need",
    arguments: { title: "Customers want one-click data export", purpose: "Reduce churn; GDPR portability.", by: pm },
  });
  console.log("  " + text(raised));
  const id = text(raised).match(/intent-[0-9a-f]+/)?.[0];
  if (!id) throw new Error("could not parse raised intent id");

  console.log("\nPM approves the intent (verifiable SSO identity)...");
  console.log("  " + text(await client.callTool({
    name: "approve_intent",
    arguments: { itemId: id, gate: "intent-approval", by: pm, note: "Greenlit for Q3." },
  })));

  console.log("\nAn UNVERIFIED approval is attempted (must be rejected)...");
  console.log("  " + text(await client.callTool({
    name: "approve_intent",
    arguments: { itemId: id, gate: "intent-approval", by: { subject: "anon", method: "unverified" } },
  })));

  console.log(`\nDone. Open the board on ADL_DB=${DB} to see the intent move Candidate -> Declared.`);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
