import { rmSync, existsSync } from "node:fs";
import { RecordStore } from "../record-store.js";
import { project } from "../projection.js";
import { ingest } from "../ingest.js";
import { MockGroundTruthAdapter } from "../adapters/mock.js";
import { raiseNeed, approveIntent } from "../gates.js";

/**
 * FULL END-TO-END run with mock providers. No external systems, no Kiro, no real GitHub.
 *
 * Every transition goes through its proper path:
 *   - agent/human actions  -> claims + identity-bound gate approvals (gates.ts)
 *   - decomposition        -> a planner declares child items under the approved intent
 *   - verification         -> a MOCK ground-truth adapter + ingest() (drop-in for GitHub);
 *                             ground truth is never posted by an agent
 *   - operate/loop         -> a mock monitoring signal raises the next need
 *
 * Run: npm run e2e
 */
const DB = "./out/e2e.jsonl";

function board(store: RecordStore, label: string) {
  console.log(`\n=== ${label} ===`);
  for (const i of project(store)) {
    const claimed = i.claimedState && i.claimedState !== i.verifiedState ? ` (claimed: ${i.claimedState})` : "";
    const flags = i.flags.length ? `  [${i.flags.join(", ")}]` : "";
    console.log(`  ${i.type.padEnd(7)} ${i.id.padEnd(26)} ${i.verifiedState.padEnd(20)}${claimed}${flags}`);
  }
}

async function main() {
  if (existsSync(DB)) rmSync(DB);
  const store = new RecordStore(DB);
  const gt = new MockGroundTruthAdapter();
  const pm = { subject: "pm@example.com", method: "sso" as const, name: "Pat (PM)" };

  // 1. PM raises a need (Candidate). The intent declares its approval gate.
  const intentId = raiseNeed(store, {
    title: "Customer data export for GDPR",
    purpose: "Let customers export their data.",
    gates: [{ name: "intent-approval", satisfiedBy: "human" }],
    by: pm,
  });
  board(store, "1. PM raised a need");

  // 2. PM approves the intent (human gate, identity-bound -> ground-truth-backed)
  approveIntent(store, { itemId: intentId, gate: "intent-approval", by: pm });
  board(store, "2. PM approved the intent (Declared)");

  // 3. Planner decomposes the intent into a claimable task. The task adds its own delivery gates
  //    (human review + tests) on top of the inherited intent gate.
  store.append({ kind: "ItemDeclared", itemId: `${intentId}-epic`, actor: "planner", data: { type: "epic", parentId: intentId, title: "Export API" } });
  const taskId = `${intentId}-task`;
  store.append({
    kind: "ItemDeclared",
    itemId: taskId,
    actor: "planner",
    data: {
      type: "task",
      parentId: `${intentId}-epic`,
      title: "POST /export route",
      gates: [
        { name: "human-review", satisfiedBy: "human" },
        { name: "tests-pass", satisfiedBy: "automated" },
      ],
    },
  });
  board(store, "3. Planner decomposed into epic + task");

  // 4. Dev (via Kiro) claims the task and reports progress -> CLAIM only (stays 'declared')
  store.append({ kind: "ClaimPosted", itemId: taskId, actor: "kiro", data: { claimedState: "in_progress" } });
  store.append({ kind: "ClaimPosted", itemId: taskId, actor: "kiro", data: { claimedState: "awaiting_validation" } });
  board(store, "4. Dev claimed + marked done -> still 'declared', claimed-not-verified");

  // 5. Ground truth lands in real steps (drop-in for GitHub), so verified state walks the
  //    columns one move at a time. Each is a ground-truth observation, never an agent claim.
  gt.set(taskId, "pr_opened");
  await ingest(store, gt, [taskId]);
  board(store, "5a. PR opened (VCS) -> In progress (verified)");

  gt.set(taskId, "tests_passed");
  await ingest(store, gt, [taskId]);
  board(store, "5b. CI passes -> Awaiting validation (human gate still open)");

  gt.set(taskId, "review_approved");
  await ingest(store, gt, [taskId]);
  board(store, "5c. Human approval -> Validated");

  // 6. Deploy + stabilize via distinct ground-truth sources (VCS merge, deployment, monitoring).
  gt.set(taskId, "merged");
  await ingest(store, gt, [taskId]);
  const deployment = new MockGroundTruthAdapter("deployment");
  deployment.set(taskId, "deployed");
  await ingest(store, deployment, [taskId]);
  board(store, "6a. Merged + deployed -> In production");

  const monitoring = new MockGroundTruthAdapter("monitoring");
  monitoring.set(taskId, "stable");
  await ingest(store, monitoring, [taskId]);
  board(store, "6b. Monitoring healthy -> Stabilized");

  // 7. Operate: monitoring raises the next need (the loop)
  const next = raiseNeed(store, { title: "Investigate export latency spike (from monitoring)", purpose: "Operational signal.", by: { subject: "monitoring@system", method: "token" } });
  board(store, "7. Monitoring raised the next need (loop)");

  // Integrity + audit
  const v = store.verify();
  console.log(`\nTamper-evident chain: ${v.ok ? "INTACT" : "BROKEN at " + v.brokenAt} (${store.all().length} records).`);
  console.log(`Next intent queued: ${next}. The journey loops on one living ledger.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
