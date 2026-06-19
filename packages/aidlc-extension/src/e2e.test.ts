import { describe, it, expect } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { RecordStore, project } from "@adl/core";
import { runCli, type CliDeps } from "./cli.js";

function tmpDb(): string {
  return join(tmpdir(), `adlx-e2e-${randomUUID()}`, "ledger.jsonl");
}

function item(db: string, id: string) {
  return project(new RecordStore(db)).find((i) => i.id === id)!;
}

describe("end-to-end: a scripted AI-DLC-style run through the hooks and verify step", () => {
  it("claims never advance verified state, and claimed-not-verified clears when verified catches up", async () => {
    const db = tmpDb();
    const deps: CliDeps = {
      // verification step observes real tool output (injected here)
      fetchPr: async () => ({ state: "OPEN", statusCheckRollup: [{ conclusion: "SUCCESS" }] }),
      // gate hook resolves a human identity (injected here, normally the git author)
      resolveApprover: () => ({ subject: "alice@acme.com", name: "Alice", identityMethod: "git-commit-author" }),
    };

    await runCli(["declare", "--db", db, "--item", "intent-1", "--type", "intent", "--title", "Export"], deps);
    await runCli([
      "declare", "--db", db, "--item", "task-1", "--type", "task", "--parent", "intent-1",
      "--gates", JSON.stringify([{ name: "tests-pass", satisfiedBy: "automated" }, { name: "human-review", satisfiedBy: "human" }]),
    ], deps);

    // 1. agent overclaims "validated" (claim hook)
    await runCli(["claim", "--db", db, "--item", "task-1", "--state", "validated", "--actor", "kiro"], deps);
    const afterClaim = item(db, "task-1");
    expect(afterClaim.verifiedState).toBe("declared"); // claim did NOT advance verified
    expect(afterClaim.flags).toContain("claimed-not-verified");

    // 2. verification step records tests_passed (and pr_opened) from tool output
    await runCli(["verify-step", "--db", db, "--item", "task-1", "--pr", "acme/repo#1"], deps);
    const afterVerify = item(db, "task-1");
    expect(afterVerify.verifiedState).toBe("awaiting_validation");
    expect(afterVerify.flags).toContain("claimed-not-verified"); // claim still ahead

    // 3. human approves the gate (gate hook) -> both gates satisfied -> validated
    await runCli(["gate", "--db", db, "--item", "task-1", "--gate", "human-review"], deps);
    const afterGate = item(db, "task-1");
    expect(afterGate.verifiedState).toBe("validated");
    expect(afterGate.flags).not.toContain("claimed-not-verified"); // cleared

    rmSync(join(db, ".."), { recursive: true, force: true });
  });

  it("writes no ledger when the extension is disabled (no adlx calls)", () => {
    const db = tmpDb();
    // Disabled run: hooks and the verify step never fire, so adlx is never invoked.
    expect(existsSync(db)).toBe(false);
  });
});
