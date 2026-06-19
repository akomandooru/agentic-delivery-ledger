import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runCli } from "./cli.js";

function tmpDb(): string {
  return join(tmpdir(), `adlx-observe-${randomUUID()}`, "ledger.jsonl");
}

const ok = `node -e "process.exit(0)"`;
const fail = `node -e "process.exit(1)"`;

describe("adlx observe: ground truth bound to a real command result", () => {
  it("records the signal when the command exits 0", async () => {
    const db = tmpDb();
    await runCli(["declare", "--db", db, "--item", "task-1", "--type", "task"]);
    const r = await runCli(["observe", "--db", db, "--item", "task-1", "--signal", "tests_passed", "--cmd", ok]);
    expect(r.code).toBe(0);
    const lines = readFileSync(db, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.some((e) => e.kind === "GroundTruthObserved" && e.data.signal === "tests_passed")).toBe(true);
    rmSync(join(db, ".."), { recursive: true, force: true });
  });

  it("records nothing when the command fails", async () => {
    const db = tmpDb();
    await runCli(["declare", "--db", db, "--item", "task-1", "--type", "task"]);
    const before = readFileSync(db, "utf-8");
    const r = await runCli(["observe", "--db", db, "--item", "task-1", "--signal", "tests_passed", "--cmd", fail]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no ground truth recorded");
    expect(readFileSync(db, "utf-8")).toBe(before); // ledger unchanged
    rmSync(join(db, ".."), { recursive: true, force: true });
  });
});
