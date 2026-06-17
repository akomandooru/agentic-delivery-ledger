import { describe, it, expect } from "vitest";
import { mapPrToSignals } from "./github.js";

describe("mapPrToSignals", () => {
  it("open PR -> pr_opened only", () => {
    expect(mapPrToSignals({ state: "OPEN" })).toEqual(["pr_opened"]);
  });

  it("approved review -> review_approved", () => {
    const s = mapPrToSignals({ state: "OPEN", reviews: [{ state: "APPROVED" }] });
    expect(s).toContain("review_approved");
  });

  it("all checks green -> tests_passed", () => {
    const s = mapPrToSignals({
      state: "OPEN",
      statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "SUCCESS" }],
    });
    expect(s).toContain("tests_passed");
  });

  it("mixed checks -> no tests_passed", () => {
    const s = mapPrToSignals({
      state: "OPEN",
      statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }],
    });
    expect(s).not.toContain("tests_passed");
  });

  it("merged PR -> merged", () => {
    expect(mapPrToSignals({ state: "MERGED" })).toContain("merged");
  });
});
