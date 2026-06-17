import { RecordStore } from "../record-store.js";
import { computeRetro, formatDuration } from "../retro.js";

/**
 * Retro / metrics report over a ledger. Read-only; safe to run anytime.
 *
 *   ADL_DB=./out/journey.jsonl npm run retro                 # whole ledger
 *   ADL_DB=./out/journey.jsonl npm run retro -- intent-abc12 # scoped to one intent's subtree
 *
 * Defaults to the journey record so it pairs with `npm run journey`.
 */
const DB = process.env.ADL_DB ?? "./out/journey.jsonl";
const intentId = process.argv[2] || process.env.ADL_INTENT || undefined;

function bar(rate: number, width = 20): string {
  const filled = Math.round(rate * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function main() {
  const store = new RecordStore(DB);
  const r = computeRetro(store, { intentId });

  console.log(`\n=== Agentic Delivery Ledger — Retro / Metrics ===`);
  console.log(`record: ${DB}`);
  if (r.scopeIntentId) console.log(`scope:  intent ${r.scopeIntentId} — ${r.scopeIntentTitle}`);
  else console.log(`scope:  whole ledger`);
  console.log(`generated: ${r.generatedAt}`);
  console.log(`${r.totalItems} work items · ${r.totalEvents} recorded events\n`);

  console.log(`Delivery funnel (current verified state)`);
  if (!r.funnel.length) console.log(`  (no items)`);
  for (const f of r.funnel) console.log(`  ${f.state.padEnd(20)} ${f.count}`);

  console.log(`\nClaim accuracy (agent self-assertion vs verified ground truth)`);
  const c = r.claims;
  console.log(`  claims posted:                 ${c.totalClaims}`);
  console.log(`  optimistic when posted:        ${c.aheadWhenPosted}  (claimed ahead of verified)`);
  console.log(`  eventually substantiated:      ${c.substantiated} / ${c.totalClaims}`);
  console.log(`  accuracy:                      ${bar(c.accuracy)} ${(c.accuracy * 100).toFixed(0)}%`);
  console.log(`  currently claimed-not-verified: ${c.currentlyClaimedNotVerified}`);

  console.log(`\nCycle time per verified state (where work waits)`);
  if (!r.stageTimings.length) console.log(`  (not enough transitions yet)`);
  for (const s of r.stageTimings) {
    const flag = r.bottleneck && s.state === r.bottleneck.state ? "  <- slowest" : "";
    console.log(`  ${s.state.padEnd(20)} mean ${formatDuration(s.meanMs).padStart(7)}  max ${formatDuration(s.maxMs).padStart(7)}  (n=${s.samples})${flag}`);
  }

  console.log(`\nGate effectiveness (declared vs satisfied by ground truth)`);
  if (!r.gates.length) console.log(`  (no gates declared)`);
  for (const g of r.gates) {
    console.log(`  ${g.name.padEnd(18)} ${g.satisfiedBy.padEnd(9)} ${bar(g.satisfactionRate)} ${g.satisfiedOn}/${g.declaredOn}`);
  }

  console.log(`\nFlags raised`);
  console.log(`  out-of-bounds:        ${r.flags.outOfBounds}`);
  console.log(`  claimed-not-verified: ${r.flags.claimedNotVerified}`);
  console.log();
}

main();
