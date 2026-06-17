import { rmSync, existsSync } from "node:fs";
import { RecordStore } from "../record-store.js";
import { project } from "../projection.js";
import { seedFullJourney } from "./seed.js";

/**
 * Demo runner (no Kiro/MCP needed): seeds the full journey, then simulates the LIVE slice
 * the way the Kiro demo would drive it via MCP + ground truth, and prints the board state at
 * each step so you can see claimed-vs-verified in action.
 *
 * Run: npm run demo
 */
const DB = "./out/demo.jsonl";

function printBoard(store: RecordStore, label: string) {
  const items = project(store);
  console.log(`\n=== ${label} ===`);
  for (const i of items) {
    const claimed = i.claimedState && i.claimedState !== i.verifiedState ? ` (claimed: ${i.claimedState})` : "";
    const flags = i.flags.length ? `  [${i.flags.join(", ")}]` : "";
    console.log(`  ${i.type.padEnd(7)} ${i.id.padEnd(28)} ${i.verifiedState.padEnd(20)}${claimed}${flags}`);
  }
}

function main() {
  if (existsSync(DB)) rmSync(DB);
  const store = new RecordStore(DB);

  seedFullJourney(store);
  printBoard(store, "After seeding the full journey");

  // LIVE slice — step 1: developer (via Kiro) claims the task and works
  store.append({ kind: "ClaimPosted", itemId: "task-export-route", actor: "kiro", data: { claimedState: "in_progress" } });
  printBoard(store, "Kiro: claimed the task (in progress)");

  // step 2: Kiro reports done -> claimed, but NOT verified
  store.append({ kind: "ClaimPosted", itemId: "task-export-route", actor: "kiro", data: { claimedState: "awaiting_validation" } });
  printBoard(store, "Kiro: marked done -> should show claimed-not-verified");

  // step 3: real ground truth lands — tests pass + a human approves the PR
  store.append({ kind: "GroundTruthObserved", itemId: "task-export-route", actor: "github", data: { signal: "tests_passed" } });
  store.append({ kind: "GroundTruthObserved", itemId: "task-export-route", actor: "github", data: { signal: "review_approved", by: "alice" } });
  printBoard(store, "Ground truth: tests pass + human approval -> Validated");

  console.log("\nNote: 'task-export-route' only became validated from ground truth, not from Kiro's claim.");

  const v = store.verify();
  console.log(`\nTamper-evident chain check: ${v.ok ? "INTACT" : "BROKEN at " + v.brokenAt} (${store.all().length} records, AAT-style SHA-256 chain).`);
}

main();
