import { describe, it, expect } from "vitest";
import { runVerificationStep } from "./verify-step.js";
import type { EventInput } from "./record.js";

describe("verification step: ground truth only from tool output", () => {
  it("maps real PR tool output to L2 GroundTruthObserved events", async () => {
    const recorded: EventInput[] = [];
    const signals = await runVerificationStep({
      itemId: "task-1",
      prRef: "acme/repo#1",
      fetchPr: async () => ({
        state: "OPEN",
        reviews: [{ state: "APPROVED" }],
        statusCheckRollup: [{ conclusion: "SUCCESS" }],
      }),
      append: (i) => recorded.push(i),
    });
    expect(signals).toEqual(expect.arrayContaining(["pr_opened", "review_approved", "tests_passed"]));
    expect(recorded.length).toBe(signals.length);
    expect(recorded.every((e) => e.kind === "GroundTruthObserved")).toBe(true);
    expect(recorded.every((e) => e.trustLevel === "L2")).toBe(true);
    expect(recorded.every((e) => (e.data as { evidence?: string }).evidence === "acme/repo#1")).toBe(true);
  });

  it("records nothing when the tool is unavailable (no agent-asserted ground truth)", async () => {
    const recorded: EventInput[] = [];
    const signals = await runVerificationStep({
      itemId: "task-1",
      prRef: "acme/repo#1",
      fetchPr: async () => null,
      append: (i) => recorded.push(i),
    });
    expect(signals).toEqual([]);
    expect(recorded).toEqual([]);
  });
});
