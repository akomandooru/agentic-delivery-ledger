import { rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { RecordStore } from "../record-store.js";
import { project } from "../projection.js";
import { ingest } from "../ingest.js";
import { MockGroundTruthAdapter } from "../adapters/mock.js";
import { raiseNeed, approveIntent } from "../gates.js";

/**
 * INTERACTIVE end-to-end journey. You step through the full lifecycle; the external stages use
 * mock providers, and the claim step can be done for REAL in Kiro (via the MCP server) or mocked.
 *
 * Setup for the live Kiro step:
 *   - `.kiro/settings/mcp.json` registers the server with ADL_DB=./out/journey.jsonl
 *   - run the board in another terminal:  ADL_DB=./out/journey.jsonl PORT=4000 npm start -w @adl/board
 *
 * Run: npm run journey
 */
const DB = "./out/journey.jsonl";

function board(store: RecordStore, label: string) {
  store.reload();
  console.log(`\n----- ${label} -----`);
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

  // Interactive when run in a real terminal; auto-advance (mock claim) when piped / JOURNEY_AUTO.
  const auto = !!process.env.JOURNEY_AUTO || !stdin.isTTY;
  const rl = auto ? null : createInterface({ input: stdin, output: stdout });
  const pause = async (msg: string) => {
    if (auto) console.log(`\n>> ${msg} (auto)`);
    else await rl!.question(`\n>> ${msg} [Enter] `);
  };

  console.log("Interactive Agentic Delivery Ledger journey.");
  console.log(`Record: ${DB}`);
  // Use an absolute path: `npm start -w @adl/board` runs with cwd=packages/board, so a
  // relative ADL_DB would resolve against the wrong directory and the board would look empty.
  const absDB = resolve(DB);
  console.log("Tip: in another terminal run the board (open http://localhost:4000):");
  console.log(`  bash/zsh:    ADL_DB="${absDB}" PORT=4000 npm start -w @adl/board`);
  console.log(`  PowerShell:  $env:ADL_DB="${absDB}"; $env:PORT="4000"; npm start -w @adl/board`);
  console.log(`  cmd.exe:     set ADL_DB=${absDB}&& set PORT=4000&& npm start -w @adl/board`);

  await pause("Stage 1: PM raises a market need");
  const intentId = raiseNeed(store, {
    title: "Customer data export for GDPR",
    purpose: "Let customers export their data.",
    gates: [{ name: "intent-approval", satisfiedBy: "human" }],
    by: pm,
  });
  board(store, "Candidate raised");

  await pause("Stage 2: PM approves the intent (human gate)");
  approveIntent(store, { itemId: intentId, gate: "intent-approval", by: pm });
  board(store, "Intent approved -> Validated");

  await pause("Stage 3: planner decomposes the intent into a task");
  store.append({ kind: "ItemDeclared", itemId: `${intentId}-epic`, actor: "planner", data: { type: "epic", parentId: intentId, title: "Export API" } });
  const taskId = `${intentId}-task`;
  store.append({
    kind: "ItemDeclared", itemId: taskId, actor: "planner",
    data: { type: "task", parentId: `${intentId}-epic`, title: "POST /export route", gates: [{ name: "human-review", satisfiedBy: "human" }, { name: "tests-pass", satisfiedBy: "automated" }] },
  });
  board(store, "Decomposed");

  // Stage 4: the real Kiro work (or mock fallback)
  console.log(`\n=== Stage 4: claim and work the task ===`);
  console.log(`Task id: ${taskId}`);
  console.log("Option A (live): in Kiro, run  ->  claim " + taskId + "   then   update_status " + taskId + " done");
  console.log("Option B (mock): type 'm' here to simulate the claim without Kiro.");
  let choice = "m";
  if (!auto) {
    choice = (await rl!.question("Type 'm' to mock, or do it in Kiro then press [Enter]: ")).trim().toLowerCase();
  } else {
    console.log("(auto) simulating the claim without Kiro.");
  }
  if (choice === "m") {
    store.append({ kind: "ClaimPosted", itemId: taskId, actor: "kiro", data: { claimedState: "in_progress" } });
    store.append({ kind: "ClaimPosted", itemId: taskId, actor: "kiro", data: { claimedState: "awaiting_validation" } });
  }
  // The card stays in DECLARED (verified): a claim never moves verified state. It just carries
  // the claimed overlay and the claimed-not-verified flag.
  board(store, "After claim (still 'declared' verified; claimed-not-verified)");

  // Ground truth now arrives in real steps, so verified state walks the columns one move at a
  // time instead of jumping. Each step is a separate ground-truth observation (never a claim).
  await pause("Stage 5a: agent opened a PR; VCS observes it -> In progress");
  gt.set(taskId, "pr_opened");
  await ingest(store, gt, [taskId]);
  board(store, "PR opened -> In progress (verified, not a claim)");

  await pause("Stage 5b: CI passes -> Awaiting validation (human gate still open)");
  gt.set(taskId, "tests_passed");
  await ingest(store, gt, [taskId]);
  board(store, "Tests pass -> Awaiting validation (rests here: human-review gate unmet)");

  await pause("Stage 5c: a human approves (identity-bound) -> Validated");
  gt.set(taskId, "review_approved");
  await ingest(store, gt, [taskId]);
  board(store, "Approved -> Validated (both gates satisfied; claimed-not-verified clears)");

  await pause("Stage 6: deployment ground truth lands -> In production");
  // VCS observes the merge; the deployment system observes the rollout. Both are real
  // ground-truth sources (actor = adapter:<name>), never an agent claim.
  gt.set(taskId, "merged");
  await ingest(store, gt, [taskId]);
  const deployment = new MockGroundTruthAdapter("deployment");
  deployment.set(taskId, "deployed");
  await ingest(store, deployment, [taskId]);
  board(store, "Deployed -> In production");

  await pause("Stage 7: monitoring probe reports healthy -> Stabilized");
  const monitoring = new MockGroundTruthAdapter("monitoring");
  monitoring.set(taskId, "stable");
  await ingest(store, monitoring, [taskId]);
  board(store, "Stable -> Stabilized (intent/epic roll up to stabilized)");

  await pause("Stage 8: monitoring raises the next need (the loop)");
  const next = raiseNeed(store, { title: "Investigate export latency spike (from monitoring)", purpose: "Operational signal.", by: { subject: "monitoring@system", method: "token" } });
  board(store, "Next need queued");

  const v = store.verify();
  console.log(`\nTamper-evident chain: ${v.ok ? "INTACT" : "BROKEN at " + v.brokenAt} (${store.all().length} records).`);
  console.log(`The journey looped: next intent is ${next}. One living ledger, no project/support split.`);
  rl?.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
