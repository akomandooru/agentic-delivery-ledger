import { describe, it, expect, beforeEach } from "vitest";
import { rmSync, existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RecordStore, project } from "@adl/core";
import { buildServer } from "./server.js";

const DB = "./out/mcp-itest.jsonl";

function text(res: unknown): string {
  const r = res as { content?: { type: string; text?: string }[] };
  return (r.content ?? []).map((c) => c.text ?? "").join("\n");
}

async function connect(store: RecordStore) {
  const server = buildServer(store);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await client.connect(clientT);
  return client;
}

describe("integration: MCP client -> server -> record -> projection", () => {
  let store: RecordStore;
  beforeEach(() => {
    if (existsSync(DB)) rmSync(DB);
    store = new RecordStore(DB);
  });

  it("upstream PM flow: raise_need then approve_intent moves candidate -> declared", async () => {
    const client = await connect(store);
    const pm = { subject: "pm@co", method: "sso", name: "PM" };

    const raised = await client.callTool({ name: "raise_need", arguments: { title: "Export data", by: pm } });
    const id = text(raised).match(/intent-[0-9a-f]+/)?.[0]!;
    expect(project(store).find((i) => i.id === id)?.verifiedState).toBe("candidate");

    await client.callTool({ name: "approve_intent", arguments: { itemId: id, gate: "intent-approval", by: pm } });
    // human approval is real ground truth -> intent's human gate satisfied
    const item = project(store).find((i) => i.id === id)!;
    expect(item.verifiedState).not.toBe("candidate");
    await client.close();
  });

  it("rejects an unverified gate approval through the server", async () => {
    const client = await connect(store);
    const raised = await client.callTool({
      name: "raise_need",
      arguments: { title: "X", by: { subject: "pm@co", method: "sso" } },
    });
    const id = text(raised).match(/intent-[0-9a-f]+/)?.[0]!;
    const res = await client.callTool({
      name: "approve_intent",
      arguments: { itemId: id, gate: "g", by: { subject: "anon", method: "unverified" } },
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(text(res)).toMatch(/Rejected/);
    await client.close();
  });

  it("a claim via update_status shows claimed-not-verified (not validated)", async () => {
    // declare a task with a human gate directly in the record
    store.append({
      kind: "ItemDeclared",
      itemId: "task-x",
      actor: "seed",
      data: { type: "intent", title: "Task X", gates: [{ name: "human-review", satisfiedBy: "human" }] },
    });
    const client = await connect(store);
    await client.callTool({ name: "update_status", arguments: { itemId: "task-x", status: "done", agent: "kiro" } });
    const item = project(store).find((i) => i.id === "task-x")!;
    expect(item.flags).toContain("claimed-not-verified");
    expect(item.verifiedState).not.toBe("validated");
    await client.close();
  });
});
