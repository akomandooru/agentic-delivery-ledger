import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runCli } from "./cli.js";

function tmpDb(): string {
  return join(tmpdir(), `adlx-tamper-${randomUUID()}`, "ledger.jsonl");
}

async function seed(db: string) {
  await runCli(["declare", "--db", db, "--item", "intent-1", "--type", "intent", "--title", "X"]);
  await runCli(["declare", "--db", db, "--item", "task-1", "--type", "task", "--parent", "intent-1"]);
  await runCli(["claim", "--db", db, "--item", "task-1", "--state", "awaiting_validation", "--actor", "kiro"]);
}

describe("tamper-evidence", () => {
  it("reports INTACT with the record count for an untouched ledger", async () => {
    const db = tmpDb();
    await seed(db);
    const v = await runCli(["verify", db]);
    expect(v.code).toBe(0);
    expect(v.stdout).toBe("INTACT (3 records)");
    rmSync(join(db, ".."), { recursive: true, force: true });
  });

  it("reports BROKEN at the correct index when a record is altered", async () => {
    const db = tmpDb();
    await seed(db);

    // Mutate the genesis record's data; this breaks the link the next record points back to.
    const lines = readFileSync(db, "utf-8").trim().split("\n");
    const genesis = JSON.parse(lines[0]);
    genesis.data.title = "tampered";
    lines[0] = JSON.stringify(genesis);
    writeFileSync(db, lines.join("\n") + "\n", "utf-8");

    const v = await runCli(["verify", db]);
    expect(v.code).toBe(1);
    expect(v.stdout).toBe("BROKEN at record 1");

    rmSync(join(db, ".."), { recursive: true, force: true });
  });
});
