import { describe, it, expect } from "vitest";
import { rmSync, existsSync } from "node:fs";
import { RecordStore } from "./record-store.js";
import { auditForIntent } from "./audit.js";

const DB = "./out/audit-test.jsonl";

function fresh(): RecordStore {
  if (existsSync(DB)) rmSync(DB);
  return new RecordStore(DB);
}

describe("audit export (roll-up + gate evidence)", () => {
  it("rolls up an intent's descendants and records gate evidence", () => {
    const store = fresh();
    store.append({
      kind: "ItemDeclared",
      itemId: "intent-x",
      actor: "t",
      data: {
        type: "intent",
        title: "Intent X",
        gates: [
          { name: "human-review", satisfiedBy: "human" },
          { name: "tests-pass", satisfiedBy: "automated" },
        ],
      },
    });
    store.append({ kind: "ItemDeclared", itemId: "task-y", actor: "t", data: { type: "task", parentId: "intent-x", title: "Task Y" } });
    store.append({ kind: "GroundTruthObserved", itemId: "task-y", actor: "github", data: { signal: "tests_passed", evidence: "org/repo#1" } });
    store.append({ kind: "GroundTruthObserved", itemId: "task-y", actor: "github", data: { signal: "review_approved", evidence: "org/repo#1" } });

    const audit = auditForIntent(store, "intent-x");
    expect(audit.items.map((i) => i.id).sort()).toEqual(["intent-x", "task-y"]);

    const taskAudit = audit.items.find((i) => i.id === "task-y")!;
    const human = taskAudit.gates.find((g) => g.name === "human-review")!;
    const tests = taskAudit.gates.find((g) => g.name === "tests-pass")!;
    expect(human.satisfied).toBe(true);
    expect(tests.satisfied).toBe(true);
    expect(human.evidence[0].signal).toBe("review_approved");
    expect(taskAudit.verifiedState).toBe("validated");
  });

  it("shows a gate as unsatisfied when ground truth is missing", () => {
    const store = fresh();
    store.append({
      kind: "ItemDeclared",
      itemId: "intent-z",
      actor: "t",
      data: { type: "intent", title: "Intent Z", gates: [{ name: "human-review", satisfiedBy: "human" }] },
    });
    store.append({ kind: "ItemDeclared", itemId: "task-w", actor: "t", data: { type: "task", parentId: "intent-z", title: "Task W" } });
    store.append({ kind: "ClaimPosted", itemId: "task-w", actor: "kiro", data: { claimedState: "awaiting_validation" } });

    const audit = auditForIntent(store, "intent-z");
    const taskAudit = audit.items.find((i) => i.id === "task-w")!;
    expect(taskAudit.gates[0].satisfied).toBe(false); // claim alone does not satisfy a human gate
    expect(taskAudit.flags).toContain("claimed-not-verified");
  });
});
