import { describe, it, expect } from "vitest";
import { reconcile } from "./reconcile.js";
import type { Gate, RecordEvent, WorkItem } from "@adl/protocol";

const now = "2026-01-01T00:00:00.000Z";

function declared(): WorkItem {
  return {
    id: "task-1",
    type: "task",
    title: "task-1",
    verifiedState: "declared",
    flags: [],
    createdAt: now,
    updatedAt: now,
  };
}

function ev(kind: RecordEvent["kind"], data: Record<string, unknown>): RecordEvent {
  return { id: Math.random().toString(), kind, itemId: "task-1", at: now, actor: "test", trustLevel: "L3", data, prevHash: null };
}

const gates: Gate[] = [
  { name: "human-review", satisfiedBy: "human" },
  { name: "tests-pass", satisfiedBy: "automated" },
];

describe("reconcile: claimed vs verified guarantees", () => {
  it("an agent claim of 'done' does NOT verify the item", () => {
    const r = reconcile({
      declared: declared(),
      gates,
      events: [ev("ClaimPosted", { claimedState: "awaiting_validation" })],
    });
    expect(r.claimedState).toBe("awaiting_validation");
    expect(r.verifiedState).not.toBe("validated");
    expect(r.flags).toContain("claimed-not-verified");
  });

  it("human gate is NOT satisfied without a human ground-truth signal", () => {
    const r = reconcile({
      declared: declared(),
      gates,
      events: [
        ev("ClaimPosted", { claimedState: "awaiting_validation" }),
        ev("GroundTruthObserved", { signal: "tests_passed" }),
      ],
    });
    // tests passed but no human approval -> not validated
    expect(r.satisfiedGates).toContain("tests-pass");
    expect(r.satisfiedGates).not.toContain("human-review");
    expect(r.verifiedState).not.toBe("validated");
  });

  it("validates only when BOTH human approval and tests are in ground truth", () => {
    const r = reconcile({
      declared: declared(),
      gates,
      events: [
        ev("ClaimPosted", { claimedState: "awaiting_validation" }),
        ev("GroundTruthObserved", { signal: "tests_passed" }),
        ev("GroundTruthObserved", { signal: "review_approved" }),
      ],
    });
    expect(r.satisfiedGates.sort()).toEqual(["human-review", "tests-pass"]);
    expect(r.verifiedState).toBe("validated");
    expect(r.flags).not.toContain("claimed-not-verified");
  });

  it("progresses to in_production then stabilized on ground truth", () => {
    const r = reconcile({
      declared: declared(),
      gates,
      events: [
        ev("GroundTruthObserved", { signal: "tests_passed" }),
        ev("GroundTruthObserved", { signal: "review_approved" }),
        ev("GroundTruthObserved", { signal: "merged" }),
        ev("GroundTruthObserved", { signal: "stable" }),
      ],
    });
    expect(r.verifiedState).toBe("stabilized");
  });

  it("flags out-of-bounds from ground truth", () => {
    const r = reconcile({
      declared: declared(),
      gates,
      events: [ev("GroundTruthObserved", { signal: "out_of_bounds" })],
    });
    expect(r.flags).toContain("out-of-bounds");
  });

  it("the demo path: claim done -> claimed-not-verified -> approval -> validated", () => {
    // step 1: agent claims done
    const s1 = reconcile({
      declared: declared(),
      gates,
      events: [ev("ClaimPosted", { claimedState: "awaiting_validation" })],
    });
    expect(s1.flags).toContain("claimed-not-verified");
    expect(s1.verifiedState).not.toBe("validated");

    // step 2: real human approval + tests land
    const s2 = reconcile({
      declared: declared(),
      gates,
      events: [
        ev("ClaimPosted", { claimedState: "awaiting_validation" }),
        ev("GroundTruthObserved", { signal: "tests_passed" }),
        ev("GroundTruthObserved", { signal: "review_approved" }),
      ],
    });
    expect(s2.verifiedState).toBe("validated");
    expect(s2.flags).not.toContain("claimed-not-verified");
  });
});
