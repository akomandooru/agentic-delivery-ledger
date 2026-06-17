import type { Gate, LifecycleState, RecordEvent, WorkItem } from "@adl/protocol";

/**
 * Reconciliation engine.
 *
 * Computes a work item's authoritative VERIFIED state from ground-truth events only, overlays
 * the agent-CLAIMED state, and sets flags. The core guarantee: a claim never moves verified
 * state, and human-required gates are satisfied only by real human ground truth.
 */

/** Ground-truth signals the adapters emit (metadata only). */
export type GroundTruthSignal =
  | "pr_opened"
  | "review_approved" // human approval present in ground truth
  | "tests_passed"
  | "merged"
  | "deployed"
  | "stable"
  | "out_of_bounds";

const STATE_ORDER: LifecycleState[] = [
  "candidate",
  "clarifying",
  "declared",
  "proposed",
  "in_progress",
  "awaiting_validation",
  "validated",
  "in_production",
  "stabilized",
];

export function stateRank(s: LifecycleState): number {
  return STATE_ORDER.indexOf(s);
}

export interface ReconcileInput {
  /** the declared item (type, parentId, title, intent fields) */
  declared: WorkItem;
  /** effective gates for this item (own + inherited) */
  gates: Gate[];
  /** all events for this item, in order */
  events: RecordEvent[];
}

export interface ReconcileResult {
  verifiedState: LifecycleState;
  claimedState?: LifecycleState;
  flags: WorkItem["flags"];
  /** which gates are verified-satisfied (by ground truth) */
  satisfiedGates: string[];
}

/**
 * Verified state is derived purely from ground-truth signals + gate satisfaction.
 * Claims are recorded but never advance verified state.
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  const { declared, gates, events } = input;

  const signals = new Set<GroundTruthSignal>();
  let latestClaim: LifecycleState | undefined;
  let outOfBounds = false;

  for (const e of events) {
    if (e.kind === "ClaimPosted") {
      const cs = e.data?.claimedState as LifecycleState | undefined;
      if (cs) latestClaim = cs;
    } else if (e.kind === "GroundTruthObserved") {
      // Standards-aligned guard: only L2+ (authority/ground-truth-backed) records supply verified
      // signals. A record's trust defaults to its kind's level (ground truth = L3); an explicit
      // low level (L0/L1) is filtered, so a self-asserted record can never advance verified state.
      const trust = (e as { trustLevel?: string }).trustLevel ?? "L3";
      const rank = Number(trust.replace("L", ""));
      if (rank < 2) continue;
      const sig = e.data?.signal as GroundTruthSignal | undefined;
      if (sig) {
        signals.add(sig);
        if (sig === "out_of_bounds") outOfBounds = true;
      }
    }
  }

  // Which gates are satisfied by ground truth?
  const satisfiedGates: string[] = [];
  for (const g of gates) {
    if (isGateSatisfied(g, signals)) satisfiedGates.push(g.name);
  }
  const allGatesSatisfied = gates.length === 0 || gates.every((g) => satisfiedGates.includes(g.name));

  // Derive verified state from ground truth (monotonic, never from a claim).
  let verified: LifecycleState = declared.verifiedState ?? "declared";
  const advance = (s: LifecycleState) => {
    if (stateRank(s) > stateRank(verified)) verified = s;
  };

  if (signals.has("pr_opened")) advance("in_progress");
  // "awaiting_validation" as a verified state means work is done and queued; we treat a passed
  // test or opened PR awaiting review as awaiting_validation only if not yet fully validated.
  if (signals.has("tests_passed") || signals.has("review_approved")) advance("awaiting_validation");
  if (allGatesSatisfied && gates.length > 0) advance("validated");
  // in_production is reached by a deployment/VCS ground-truth observation. A `deployed` signal
  // (deployment system) is the canonical trigger; `merged` (VCS) also counts for trunk-based CD.
  if (signals.has("merged") || signals.has("deployed")) advance("in_production");
  // stabilized is reached when a monitoring/probe ground-truth observation reports the live
  // service is healthy.
  if (signals.has("stable")) advance("stabilized");

  // Flags
  const flags: WorkItem["flags"] = [];
  if (outOfBounds) flags.push("out-of-bounds");
  // claimed-not-verified: the agent claims further along than ground truth confirms
  if (latestClaim && stateRank(latestClaim) > stateRank(verified)) {
    flags.push("claimed-not-verified");
  }

  return { verifiedState: verified, claimedState: latestClaim, flags, satisfiedGates };
}

/**
 * A gate is satisfied only by the right kind of ground truth.
 * Human gates REQUIRE a human ground-truth signal (review_approved); they can never be
 * satisfied by an agent claim.
 */
function isGateSatisfied(gate: Gate, signals: Set<GroundTruthSignal>): boolean {
  if (gate.satisfiedBy === "human") {
    return signals.has("review_approved");
  }
  // automated gates (e.g. tests-pass)
  if (gate.name.toLowerCase().includes("test")) return signals.has("tests_passed");
  // generic automated gate: satisfied if any automated evidence exists
  return signals.has("tests_passed") || signals.has("merged");
}
