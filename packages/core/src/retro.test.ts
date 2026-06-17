import { describe, it, expect } from "vitest";
import { rmSync, existsSync } from "node:fs";
import { RecordStore } from "./record-store.js";
import { computeRetro, formatDuration } from "./retro.js";

const DB = "./out/retro-test.jsonl";
function fresh(): RecordStore {
  if (existsSync(DB)) rmSync(DB);
  return new RecordStore(DB);
}

describe("retro / metrics over the ledger", () => {
  it("measures claim accuracy, gate satisfaction, and the funnel", () => {
    const store = fresh();
    // a task with two gates
    store.append({
      kind: "ItemDeclared",
      itemId: "task-1",
      actor: "planner",
      data: { type: "task", title: "Task 1", gates: [
        { name: "human-review", satisfiedBy: "human" },
        { name: "tests-pass", satisfiedBy: "automated" },
      ] },
    });
    // agent claims done before any ground truth (optimistic)
    store.append({ kind: "ClaimPosted", itemId: "task-1", actor: "kiro", data: { claimedState: "awaiting_validation" } });
    // ground truth eventually substantiates it
    store.append({ kind: "GroundTruthObserved", itemId: "task-1", actor: "adapter:ci", data: { signal: "tests_passed" } });
    store.append({ kind: "GroundTruthObserved", itemId: "task-1", actor: "human@co", data: { signal: "review_approved" } });

    const r = computeRetro(store);

    expect(r.totalItems).toBe(1);
    expect(r.claims.totalClaims).toBe(1);
    expect(r.claims.aheadWhenPosted).toBe(1); // claim came before verification
    expect(r.claims.substantiated).toBe(1); // verified later reached awaiting_validation
    expect(r.claims.accuracy).toBe(1);

    const human = r.gates.find((g) => g.name === "human-review")!;
    const tests = r.gates.find((g) => g.name === "tests-pass")!;
    expect(human.satisfiedOn).toBe(1);
    expect(tests.satisfiedOn).toBe(1);

    expect(r.funnel.find((f) => f.state === "validated")?.count).toBe(1);
  });

  it("counts an unsubstantiated claim and the claimed-not-verified flag", () => {
    const store = fresh();
    store.append({
      kind: "ItemDeclared",
      itemId: "task-2",
      actor: "planner",
      data: { type: "task", title: "Task 2", gates: [{ name: "human-review", satisfiedBy: "human" }] },
    });
    // agent claims done; no ground truth ever arrives
    store.append({ kind: "ClaimPosted", itemId: "task-2", actor: "kiro", data: { claimedState: "awaiting_validation" } });

    const r = computeRetro(store);
    expect(r.claims.totalClaims).toBe(1);
    expect(r.claims.substantiated).toBe(0);
    expect(r.claims.unsubstantiated).toBe(1);
    expect(r.claims.accuracy).toBe(0);
    expect(r.flags.claimedNotVerified).toBe(1);
    expect(r.claims.currentlyClaimedNotVerified).toBe(1);
  });

  it("formats durations compactly", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(2300)).toBe("2.3s");
    expect(formatDuration(90_000)).toBe("1.5m");
  });

  it("scopes the report to a single intent's subtree", () => {
    const store = fresh();
    // intent A with one child task, plus an unrelated intent B
    store.append({ kind: "ItemDeclared", itemId: "intent-a", actor: "pm", data: { type: "intent", title: "A", initialState: "candidate" } });
    store.append({ kind: "ItemDeclared", itemId: "task-a", actor: "planner", data: { type: "task", parentId: "intent-a", title: "Task A", gates: [{ name: "tests-pass", satisfiedBy: "automated" }] } });
    store.append({ kind: "GroundTruthObserved", itemId: "task-a", actor: "adapter:ci", data: { signal: "tests_passed" } });
    store.append({ kind: "ItemDeclared", itemId: "intent-b", actor: "pm", data: { type: "intent", title: "B", initialState: "candidate" } });

    const whole = computeRetro(store);
    expect(whole.totalItems).toBe(3);

    const scoped = computeRetro(store, { intentId: "intent-a" });
    expect(scoped.scopeIntentId).toBe("intent-a");
    expect(scoped.totalItems).toBe(2); // intent-a + task-a only
    expect(scoped.gates.find((g) => g.name === "tests-pass")?.satisfiedOn).toBe(1);

    expect(() => computeRetro(store, { intentId: "nope" })).toThrow(/Unknown intent/);
  });
});
