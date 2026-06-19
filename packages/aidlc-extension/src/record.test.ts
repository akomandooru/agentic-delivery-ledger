import { describe, it, expect } from "vitest";
import { RecordEvent as RecordEventSchema } from "@adl/protocol";
import {
  buildClaim,
  buildGateSatisfied,
  buildGroundTruth,
  buildItemDeclared,
  validateEventInput,
  ContentError,
} from "./record.js";

describe("record builders: schema-valid events with correct trust levels", () => {
  it("assigns L1 to claims, L2 to ground truth and declarations, L3 to human gates", () => {
    expect(buildClaim({ itemId: "t1", actor: "kiro", claimedState: "awaiting_validation" }).trustLevel).toBe("L1");
    expect(buildGroundTruth({ itemId: "t1", actor: "adapter", signal: "tests_passed" }).trustLevel).toBe("L2");
    expect(buildItemDeclared({ itemId: "t1", actor: "planner", type: "task" }).trustLevel).toBe("L2");
    expect(
      buildGateSatisfied({ itemId: "t1", gate: "human-review", by: "a@b.com", identityMethod: "git-commit-author" })
        .trustLevel,
    ).toBe("L3");
  });

  it("produces events that validate against the protocol schema", () => {
    const inputs = [
      buildItemDeclared({ itemId: "intent-1", actor: "pm@acme", type: "intent", title: "X" }),
      buildClaim({ itemId: "t1", actor: "kiro", claimedState: "awaiting_validation" }),
      buildGroundTruth({ itemId: "t1", actor: "adapter:github", signal: "tests_passed", evidence: "acme/repo#1" }),
      buildGateSatisfied({ itemId: "t1", gate: "human-review", by: "a@b.com", identityMethod: "git-commit-author" }),
    ];
    for (const input of inputs) {
      const candidate = { ...input, id: "x", at: "2026-01-01T00:00:00.000Z", prevHash: null };
      expect(() => RecordEventSchema.parse(candidate)).not.toThrow();
    }
  });

  it("records the protocol version on declared items", () => {
    const d = buildItemDeclared({ itemId: "intent-1", actor: "pm", type: "intent" });
    expect((d.data as Record<string, unknown>).protocolVersion).toBe("0.1.0");
  });
});

describe("record builders: metadata-only enforcement", () => {
  it("rejects data keys outside the per-kind allowlist", () => {
    expect(() =>
      validateEventInput({
        kind: "ClaimPosted",
        itemId: "t1",
        actor: "kiro",
        trustLevel: "L1",
        data: { claimedState: "validated", sourceCode: "const x = 1" },
      }),
    ).toThrow(ContentError);
  });

  it("rejects multi-line content (possible source code or raw output)", () => {
    expect(() =>
      validateEventInput({
        kind: "GroundTruthObserved",
        itemId: "t1",
        actor: "a",
        trustLevel: "L2",
        data: { signal: "tests_passed", evidence: "line1\nline2" },
      }),
    ).toThrow(ContentError);
  });

  it("rejects secret-looking values", () => {
    expect(() =>
      validateEventInput({
        kind: "GateSatisfied",
        itemId: "t1",
        actor: "a",
        trustLevel: "L3",
        data: { gate: "g", by: "a@b.com", identityMethod: "password: hunter2hunter" },
      }),
    ).toThrow(ContentError);
  });

  it("accepts clean metadata", () => {
    expect(() =>
      buildGateSatisfied({ itemId: "t1", gate: "human-review", by: "a@b.com", identityMethod: "git-commit-author" }),
    ).not.toThrow();
  });
});
