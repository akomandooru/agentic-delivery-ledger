import { describe, it, expect, afterEach } from "vitest";
import { rmSync, existsSync } from "node:fs";
import { RecordStore } from "./record-store.js";
import {
  raiseNeed,
  approveIntent,
  GateApprovalError,
  setIdentityVerifier,
  resetIdentityVerifier,
  type IdentityVerifier,
} from "./gates.js";
import { project } from "./projection.js";

const DB = "./out/gates-test.jsonl";
function fresh(): RecordStore {
  if (existsSync(DB)) rmSync(DB);
  return new RecordStore(DB);
}

describe("gate approvals (identity-bound, auditable)", () => {
  it("raiseNeed creates a candidate intent", () => {
    const store = fresh();
    const id = raiseNeed(store, { title: "Export data", by: { subject: "pm@co", method: "sso" } });
    const item = project(store).find((i) => i.id === id)!;
    expect(item.type).toBe("intent");
    expect(item.verifiedState).toBe("candidate");
  });

  it("rejects approval from an unverified identity", () => {
    const store = fresh();
    const id = raiseNeed(store, { title: "X", by: { subject: "pm@co", method: "sso" } });
    expect(() =>
      approveIntent(store, { itemId: id, gate: "intent-approval", by: { subject: "pm@co", method: "unverified" } }),
    ).toThrow(GateApprovalError);
  });

  it("a verified approval satisfies the gate and is recorded as auditable ground truth", () => {
    const store = fresh();
    const id = raiseNeed(store, { title: "X", by: { subject: "pm@co", method: "sso" } });
    approveIntent(store, { itemId: id, gate: "intent-approval", by: { subject: "pm@co", method: "sso", name: "PM" } });
    const events = store.forItem(id);
    const gate = events.find((e) => e.kind === "GateSatisfied");
    const gt = events.find((e) => e.kind === "GroundTruthObserved");
    expect(gate?.data?.by).toBe("pm@co");
    expect(gate?.data?.identityMethod).toBe("sso");
    expect(gt?.data?.signal).toBe("review_approved");
  });
});

describe("pluggable identity verifier (the auth seam)", () => {
  afterEach(() => resetIdentityVerifier());

  it("a custom verifier can reject identities the default would accept", () => {
    const store = fresh();
    const id = raiseNeed(store, { title: "X", by: { subject: "pm@co", method: "sso" } });
    // Production-style verifier: only trust subjects from an allowed issuer.
    const strict: IdentityVerifier = {
      verify(claimed) {
        if (!claimed || !claimed.subject.endsWith("@corp.example")) {
          throw new GateApprovalError("identity not issued by a trusted source");
        }
        return claimed;
      },
    };
    setIdentityVerifier(strict);
    // The default verifier would accept this sso identity; the strict one rejects it.
    expect(() =>
      approveIntent(store, { itemId: id, gate: "intent-approval", by: { subject: "pm@co", method: "sso" } }),
    ).toThrow(GateApprovalError);
  });

  it("uses the identity the verifier vouches for, not the caller's self-asserted object", () => {
    const store = fresh();
    const id = raiseNeed(store, { title: "X", by: { subject: "pm@co", method: "sso" } });
    // A verifier that derives the trusted identity from a validated source (here, canonicalizes).
    const canonicalizing: IdentityVerifier = {
      verify() {
        return { subject: "verified-pm@corp.example", method: "oidc", name: "Verified PM" };
      },
    };
    setIdentityVerifier(canonicalizing);
    approveIntent(store, { itemId: id, gate: "intent-approval", by: { subject: "anything@anywhere", method: "token" } });
    const gate = store.forItem(id).find((e) => e.kind === "GateSatisfied");
    const gt = store.forItem(id).find((e) => e.kind === "GroundTruthObserved");
    expect(gate?.data?.by).toBe("verified-pm@corp.example");
    expect(gate?.data?.identityMethod).toBe("oidc");
    expect(gt?.data?.by).toBe("verified-pm@corp.example");
  });

  it("resetIdentityVerifier restores the default shape-check behavior", () => {
    const store = fresh();
    const id = raiseNeed(store, { title: "X", by: { subject: "pm@co", method: "sso" } });
    setIdentityVerifier({ verify: () => { throw new GateApprovalError("blocked"); } });
    resetIdentityVerifier();
    // Back to default: a well-formed sso identity is accepted again.
    expect(() =>
      approveIntent(store, { itemId: id, gate: "intent-approval", by: { subject: "pm@co", method: "sso" } }),
    ).not.toThrow();
  });
});
