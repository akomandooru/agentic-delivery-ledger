import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  RecordStore,
  project,
  raiseNeed,
  approveIntent,
  GateApprovalError,
  type Identity,
} from "@adl/core";

/**
 * Governance MCP server — the agent/tool claim interface.
 *
 * Client-agnostic: Kiro, Amazon Q, Cursor, a local script — all connect to this one server. It
 * is a doorway, not the record: it converts calls into events on the shared RecordStore.
 *
 * Claims (claim_item/update_status) set only the CLAIMED state and are never trusted as
 * verified. Gate approvals (approve_intent) require a verifiable identity and are recorded as
 * auditable ground truth, never as a bare claim.
 */
export function buildServer(store: RecordStore): McpServer {
  const server = new McpServer({ name: "agentic-delivery-ledger", version: "0.1.0" });

  const identityShape = {
    subject: z.string().describe("stable identity subject, e.g. user id/email"),
    method: z.enum(["sso", "token", "oidc", "unverified"]).describe("how identity was established"),
    name: z.string().optional(),
  };

  server.tool("list_work_items", "List work items with verified/claimed state and flags.", {}, async () => {
    const items = project(store).map((i) => ({
      id: i.id,
      type: i.type,
      title: i.title,
      verifiedState: i.verifiedState,
      claimedState: i.claimedState,
      flags: i.flags,
    }));
    return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
  });

  server.tool(
    "claim_item",
    "Claim a work item to work on it. Sets claimed state to in_progress (agent-asserted).",
    { itemId: z.string(), agent: z.string().default("kiro") },
    async ({ itemId, agent }) => {
      store.append({ kind: "ClaimPosted", itemId, actor: agent, data: { claimedState: "in_progress" } });
      return { content: [{ type: "text", text: `Claimed ${itemId} (claimed: in_progress).` }] };
    },
  );

  server.tool(
    "update_status",
    "Update an item's claimed status (e.g. ready_for_review, done). Records a CLAIM only; it " +
      "does not verify the item. Verified state comes from ground truth.",
    { itemId: z.string(), status: z.enum(["in_progress", "ready_for_review", "done"]), agent: z.string().default("kiro") },
    async ({ itemId, status, agent }) => {
      const claimedState = status === "in_progress" ? "in_progress" : "awaiting_validation";
      store.append({ kind: "ClaimPosted", itemId, actor: agent, data: { claimedState, reported: status } });
      return {
        content: [
          {
            type: "text",
            text: `Recorded claim '${status}' for ${itemId}. This is claimed, not verified; it will show as ` +
              `claimed-not-verified until ground truth (tests + human approval) confirms it.`,
          },
        ],
      };
    },
  );

  server.tool(
    "raise_need",
    "Raise a new candidate intent (e.g. a PM dropping a market need into the queue). An input, not a gate approval.",
    { title: z.string(), purpose: z.string().optional(), parentId: z.string().optional(), by: z.object(identityShape) },
    async ({ title, purpose, parentId, by }) => {
      const id = raiseNeed(store, { title, purpose, parentId, by: by as Identity });
      return { content: [{ type: "text", text: `Raised candidate intent ${id} ("${title}") by ${by.subject}.` }] };
    },
  );

  server.tool(
    "approve_intent",
    "Approve an intent's HUMAN gate. Requires a verifiable identity; unverified/bare approvals " +
      "are rejected. Recorded as auditable ground truth, not an agent claim.",
    { itemId: z.string(), gate: z.string().default("intent-approval"), by: z.object(identityShape), note: z.string().optional() },
    async ({ itemId, gate, by, note }) => {
      try {
        approveIntent(store, { itemId, gate, by: by as Identity, note });
        return { content: [{ type: "text", text: `Approved ${gate} on ${itemId} by ${by.subject} (${by.method}); recorded as auditable ground truth.` }] };
      } catch (e) {
        if (e instanceof GateApprovalError) {
          return { isError: true, content: [{ type: "text", text: `Rejected: ${e.message}` }] };
        }
        throw e;
      }
    },
  );

  return server;
}
