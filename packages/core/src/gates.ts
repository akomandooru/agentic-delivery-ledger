import { randomUUID } from "node:crypto";
import type { RecordStore } from "./record-store.js";

/**
 * Gate-approval operations (human gates raised/approved through a tool, e.g. a PM in Q).
 *
 * Trust rule: a human gate approval must be IDENTITY-BOUND and AUDITABLE. We never accept a
 * bare "approved" with no verifiable identity. In this reference implementation the identity is
 * an `Identity` object the caller must supply; in production it would be bound to real auth
 * (SSO / signed token). The approval is recorded as auditable ground-truth evidence.
 */
export interface Identity {
  /** stable subject id (e.g. user id / email) */
  subject: string;
  /** how the identity was established; "unverified" is rejected for human gates */
  method: "sso" | "token" | "oidc" | "unverified";
  /** display name, optional */
  name?: string;
}

export class GateApprovalError extends Error {}

/**
 * Pluggable identity verification — the auth seam.
 *
 * A verifier turns whatever the caller supplied into a TRUSTED `Identity`, or throws
 * `GateApprovalError` if it cannot be trusted. The default below only sanity-checks the shape
 * (this is a reference implementation; the caller still self-asserts). Production swaps in a
 * verifier that validates a real credential — an OIDC/JWT signature against a trusted JWKS, an
 * SSO assertion, etc. — and derives the identity from the *verified* token, not from caller input.
 *
 *   import { setIdentityVerifier } from "@adl/core";
 *   setIdentityVerifier({ verify: (claimed) => verifyMyOidcToken(claimed) });
 *
 * Swapping the verifier requires no changes to `approveIntent` or any of its callers.
 */
export interface IdentityVerifier {
  /** Return a trusted Identity, or throw GateApprovalError if it cannot be verified. */
  verify(claimed: Identity | undefined): Identity;
}

/** Default verifier: shape-check only (subject present, method not "unverified"). Not real auth. */
export const defaultIdentityVerifier: IdentityVerifier = {
  verify(claimed) {
    if (!claimed || !claimed.subject || claimed.method === "unverified") {
      throw new GateApprovalError(
        "Gate approval requires a verifiable, identity-bound actor. A bare or unverified claim is not accepted.",
      );
    }
    return claimed;
  },
};

let activeIdentityVerifier: IdentityVerifier = defaultIdentityVerifier;

/** Install a production identity verifier (OIDC/JWT/SSO). Affects all subsequent approvals. */
export function setIdentityVerifier(verifier: IdentityVerifier): void {
  activeIdentityVerifier = verifier;
}

/** Reset to the default shape-only verifier (useful in tests). */
export function resetIdentityVerifier(): void {
  activeIdentityVerifier = defaultIdentityVerifier;
}

/**
 * Verify an identity through the active verifier and narrow the type. Throws GateApprovalError
 * when the identity cannot be trusted. Returns the trusted identity the verifier vouches for.
 */
export function verifyIdentity(identity: Identity | undefined): Identity {
  return activeIdentityVerifier.verify(identity);
}

/** @deprecated Use `verifyIdentity`. Retained for back-compat; delegates to the active verifier. */
export function assertVerifiableIdentity(identity: Identity | undefined): asserts identity is Identity {
  activeIdentityVerifier.verify(identity);
}

/** PM (or anyone) raises a new candidate intent. This is an input, not a gate approval. */
export function raiseNeed(
  store: RecordStore,
  args: { title: string; purpose?: string; parentId?: string; gates?: unknown[]; by: Identity },
): string {
  const id = `intent-${randomUUID().slice(0, 8)}`;
  store.append({
    kind: "ItemDeclared",
    itemId: id,
    actor: args.by.subject,
    data: {
      type: "intent",
      title: args.title,
      purpose: args.purpose,
      parentId: args.parentId,
      gates: args.gates,
      initialState: "candidate",
      raisedBy: args.by.subject,
    },
  });
  return id;
}

/**
 * Approve an intent's gate. Requires a verifiable identity. Records the approval as an auditable
 * GateSatisfied event AND a GroundTruthObserved(review_approved) so the reconciler treats it as
 * real human ground truth (not an agent claim).
 */
export function approveIntent(
  store: RecordStore,
  args: { itemId: string; gate: string; by: Identity; note?: string },
): void {
  // Verify through the active verifier; use the identity it vouches for (production verifiers
  // derive this from a validated token rather than trusting the caller's self-asserted object).
  const by = verifyIdentity(args.by);
  const at = new Date().toISOString();
  store.append({
    kind: "GateSatisfied",
    itemId: args.itemId,
    actor: by.subject,
    at,
    data: {
      gate: args.gate,
      by: by.subject,
      identityMethod: by.method,
      note: args.note,
    },
  });
  // human approval is real ground truth for the reconciler
  store.append({
    kind: "GroundTruthObserved",
    itemId: args.itemId,
    actor: by.subject,
    at,
    data: { signal: "review_approved", by: by.subject, evidence: `gate:${args.gate}` },
  });
}
