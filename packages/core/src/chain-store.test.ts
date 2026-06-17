import { describe, it, expect, beforeEach } from "vitest";
import { rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { RecordStore } from "./record-store.js";
import { reconcile } from "./reconcile.js";
import type { Gate, RecordEvent } from "@adl/protocol";

const DB = "./out/chain-store-test.jsonl";

describe("RecordStore hash chaining + trust levels", () => {
  beforeEach(() => {
    if (existsSync(DB)) rmSync(DB);
  });

  it("links events into a verifiable chain with default trust levels", () => {
    const store = new RecordStore(DB);
    const g = store.append({ kind: "ItemDeclared", itemId: "x", actor: "seed", data: { type: "task" } });
    const c = store.append({ kind: "ClaimPosted", itemId: "x", actor: "kiro", data: { claimedState: "awaiting_validation" } });
    const gt = store.append({ kind: "GroundTruthObserved", itemId: "x", actor: "github", data: { signal: "review_approved" } });

    expect(g.prevHash).toBeNull();         // genesis
    expect(c.prevHash).not.toBeNull();     // chained
    expect(c.trustLevel).toBe("L1");       // claim = self-asserted
    expect(gt.trustLevel).toBe("L3");      // ground truth = authority-backed
    expect(store.verify().ok).toBe(true);
  });

  it("detects tampering with the on-disk log", () => {
    const store = new RecordStore(DB);
    store.append({ kind: "ItemDeclared", itemId: "x", actor: "seed", data: { type: "task" } });
    store.append({ kind: "ClaimPosted", itemId: "x", actor: "kiro", data: { claimedState: "in_progress" } });

    // tamper: rewrite the first line's data
    const lines = readFileSync(DB, "utf-8").trim().split("\n");
    const first = JSON.parse(lines[0]);
    first.data = { type: "intent", tampered: true };
    lines[0] = JSON.stringify(first);
    writeFileSync(DB, lines.join("\n") + "\n");

    const reopened = new RecordStore(DB);
    expect(reopened.verify().ok).toBe(false);
  });

  it("a low-trust (L1) ground-truth record cannot advance verified state", () => {
    const gates: Gate[] = [{ name: "human-review", satisfiedBy: "human" }];
    // forge a GroundTruthObserved at L1 (as if a claim masqueraded as ground truth)
    const forged: RecordEvent = {
      id: "f", kind: "GroundTruthObserved", itemId: "x", at: "t", actor: "kiro",
      trustLevel: "L1", data: { signal: "review_approved" }, prevHash: null,
    };
    const r = reconcile({
      declared: { id: "x", type: "task", title: "x", verifiedState: "declared", flags: [], createdAt: "t", updatedAt: "t" },
      gates,
      events: [forged],
    });
    expect(r.verifiedState).not.toBe("validated"); // L1 ignored for verification
  });
});
