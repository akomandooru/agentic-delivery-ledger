import { RecordStore } from "../record-store.js";

/**
 * Verify the tamper-evident hash chain of a ledger file. Read-only.
 *
 *   npm run verify                      # verifies ./out/journey.jsonl
 *   npm run verify -- ./out/e2e.jsonl   # verifies a specific ledger
 *   ADL_DB=./out/demo.jsonl npm run verify
 *
 * Exit code 0 if the chain is intact, 1 if it is broken (so it can gate CI).
 *
 * Demo: run it once (INTACT), edit any single character inside one line of the .jsonl,
 * run it again, and watch it report BROKEN at the first tampered record.
 */
const DB = process.argv[2] || process.env.ADL_DB || "./out/journey.jsonl";

function main() {
  const store = new RecordStore(DB);
  const count = store.all().length;
  const v = store.verify();

  console.log(`\nLedger: ${DB}`);
  if (v.ok) {
    console.log(`Tamper-evident chain: INTACT (${count} records)\n`);
    process.exit(0);
  } else {
    console.log(`Tamper-evident chain: BROKEN at record ${v.brokenAt} of ${count}`);
    console.log(`Reason: ${v.message}\n`);
    process.exit(1);
  }
}

main();
