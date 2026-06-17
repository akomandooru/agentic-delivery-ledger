import { describe, it, expect } from "vitest";
import { canonicalize, hashRecord, verifyChain } from "./chain.js";

describe("canonicalize (JCS subset)", () => {
  it("sorts object keys deterministically", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });
  it("handles nesting, arrays, and primitives", () => {
    expect(canonicalize({ z: [1, "x", true, null], a: { d: 1, c: 2 } })).toBe(
      '{"a":{"c":2,"d":1},"z":[1,"x",true,null]}',
    );
  });
});

describe("verifyChain (tamper-evidence)", () => {
  function chain() {
    const r0 = { id: "0", kind: "ItemDeclared", itemId: "x", at: "t0", actor: "a", trustLevel: "L2", data: {}, prevHash: null };
    const r1 = { id: "1", kind: "ClaimPosted", itemId: "x", at: "t1", actor: "a", trustLevel: "L1", data: { s: 1 }, prevHash: hashRecord(r0) };
    const r2 = { id: "2", kind: "GroundTruthObserved", itemId: "x", at: "t2", actor: "gh", trustLevel: "L3", data: { s: 2 }, prevHash: hashRecord(r1) };
    return [r0, r1, r2];
  }

  it("accepts an intact chain", () => {
    expect(verifyChain(chain()).ok).toBe(true);
  });

  it("requires genesis prevHash = null", () => {
    const c = chain();
    (c[0] as { prevHash: string | null }).prevHash = "deadbeef";
    const v = verifyChain(c);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(0);
  });

  it("detects a tampered middle record", () => {
    const c = chain();
    (c[1].data as { s: number }).s = 999; // tamper after the fact
    const v = verifyChain(c);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(2); // r2.prevHash no longer matches the tampered r1
  });
});
