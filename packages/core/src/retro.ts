import {
  indexItems,
  effectiveGates,
  descendants,
  type ItemType,
  type LifecycleState,
  type Boundaries,
  type Gate,
  type RecordEvent,
  type WorkItem,
} from "@adl/protocol";
import { reconcile, stateRank } from "./reconcile.js";
import type { RecordStore } from "./record-store.js";

/**
 * Retro / metrics — a read-only analytics layer over the event log.
 *
 * Traditional boards can't answer these because status is self-reported, mutable, and closes at
 * release. Here every claim, ground-truth observation, gate, and actor is recorded immutably with
 * a timestamp, so a retrospective is a replay of facts, not a reconstruction from memory:
 *
 *  - claim accuracy:   how often did agents claim a state they hadn't actually reached, and were
 *                      those claims eventually substantiated by ground truth?
 *  - cycle time:       how long did items spend in each verified state (where's the bottleneck)?
 *  - gate effectiveness: which gates were declared, how often satisfied, and which flags fired?
 *
 * Metadata only — no source code, consistent with the rest of the ledger.
 */

export interface ClaimAccuracy {
  totalClaims: number;
  /** claims that, when posted, were ahead of the item's verified state (optimistic claims) */
  aheadWhenPosted: number;
  /** claims whose claimed state was eventually reached by verified ground truth */
  substantiated: number;
  /** claims never substantiated by verified state (as of now) */
  unsubstantiated: number;
  /** substantiated / totalClaims, in [0,1]; 1 when there are no claims */
  accuracy: number;
  /** items currently carrying the claimed-not-verified flag */
  currentlyClaimedNotVerified: number;
}

export interface StageTiming {
  state: LifecycleState;
  /** number of items observed to leave this state (have a measurable duration) */
  samples: number;
  /** mean time spent in this state before advancing, in milliseconds */
  meanMs: number;
  /** max time any item spent in this state, in milliseconds */
  maxMs: number;
}

export interface GateStat {
  name: string;
  satisfiedBy: "human" | "automated";
  declaredOn: number;
  satisfiedOn: number;
  /** satisfiedOn / declaredOn, in [0,1] */
  satisfactionRate: number;
}

export interface RetroReport {
  generatedAt: string;
  /** when scoped to one intent, its id and title; absent for a whole-ledger report */
  scopeIntentId?: string;
  scopeIntentTitle?: string;
  totalEvents: number;
  totalItems: number;
  /** current count of items per verified state (the funnel) */
  funnel: { state: LifecycleState; count: number }[];
  claims: ClaimAccuracy;
  stageTimings: StageTiming[];
  gates: GateStat[];
  flags: { outOfBounds: number; claimedNotVerified: number };
  /** the verified state with the highest mean dwell time (likely bottleneck), if any */
  bottleneck?: StageTiming;
}

/** A single verified-state transition for one item, with the time it was reached. */
interface TimelinePoint {
  state: LifecycleState;
  at: string;
}

/** Rebuild the declared (pre-reconcile) item from its ItemDeclared event. */
function declaredItem(itemId: string, events: readonly RecordEvent[]): WorkItem | undefined {
  const decl = events.find((e) => e.itemId === itemId && e.kind === "ItemDeclared");
  if (!decl) return undefined;
  const d = (decl.data ?? {}) as Record<string, unknown>;
  return {
    id: itemId,
    type: (d.type as ItemType) ?? "task",
    parentId: d.parentId as string | undefined,
    title: (d.title as string) ?? itemId,
    purpose: d.purpose as string | undefined,
    boundaries: d.boundaries as Boundaries | undefined,
    gates: d.gates as Gate[] | undefined,
    verifiedState: (d.initialState as LifecycleState) ?? "declared",
    flags: [],
    createdAt: decl.at,
    updatedAt: decl.at,
  };
}

/**
 * Replay an item's events in order, recomputing verified state after each, and record the first
 * time the item entered each verified state. This recovers the verified-state timeline from the
 * append-only log (verified state is a projection, not stored as transition events).
 */
function verifiedTimeline(declared: WorkItem, gates: Gate[], events: RecordEvent[]): TimelinePoint[] {
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const points: TimelinePoint[] = [{ state: declared.verifiedState, at: declared.createdAt }];
  let last = declared.verifiedState;
  for (let k = 1; k <= ordered.length; k++) {
    const r = reconcile({ declared, gates, events: ordered.slice(0, k) });
    if (stateRank(r.verifiedState) > stateRank(last)) {
      points.push({ state: r.verifiedState, at: ordered[k - 1].at });
      last = r.verifiedState;
    }
  }
  return points;
}

export interface RetroOptions {
  /** scope the report to a single intent and its descendants (an "audit this delivery" view) */
  intentId?: string;
}

export function computeRetro(store: RecordStore, opts: RetroOptions = {}): RetroReport {
  const events = [...store.all()];
  const itemIds = [...new Set(events.filter((e) => e.kind === "ItemDeclared").map((e) => e.itemId))];

  // Build declared items + index once (for effective gates and roll-up scoping).
  const allDeclared = itemIds
    .map((id) => declaredItem(id, events))
    .filter((i): i is WorkItem => Boolean(i));
  const index = indexItems(allDeclared);

  // Optionally scope to one intent's subtree (the intent + all descendants).
  let scopeIntentTitle: string | undefined;
  let declared = allDeclared;
  if (opts.intentId) {
    const intent = index.get(opts.intentId);
    if (!intent) throw new Error(`Unknown intent: ${opts.intentId}`);
    scopeIntentTitle = intent.title;
    const scope = new Set<string>([intent.id, ...descendants(intent.id, index).map((i) => i.id)]);
    declared = allDeclared.filter((i) => scope.has(i.id));
  }

  // Per-state dwell durations across all items.
  const dwell = new Map<LifecycleState, number[]>();
  // Reconciled (own, non-rolled) snapshot per item for funnel/flags/gates.
  const reconciled: { item: WorkItem; gates: Gate[]; satisfiedGates: string[]; timeline: TimelinePoint[] }[] = [];

  let totalClaims = 0;
  let aheadWhenPosted = 0;
  let substantiated = 0;

  for (const base of declared) {
    const gates = effectiveGates(base.id, index);
    const itemEvents = events.filter((e) => e.itemId === base.id);
    const r = reconcile({ declared: base, gates, events: [...itemEvents] });
    const timeline = verifiedTimeline(base, gates, itemEvents);
    reconciled.push({
      item: { ...base, verifiedState: r.verifiedState, claimedState: r.claimedState, flags: r.flags },
      gates,
      satisfiedGates: r.satisfiedGates,
      timeline,
    });

    // dwell time per state (time from entering a state to entering the next)
    for (let i = 0; i + 1 < timeline.length; i++) {
      const ms = Date.parse(timeline[i + 1].at) - Date.parse(timeline[i].at);
      if (Number.isFinite(ms) && ms >= 0) {
        if (!dwell.has(timeline[i].state)) dwell.set(timeline[i].state, []);
        dwell.get(timeline[i].state)!.push(ms);
      }
    }

    // claim accuracy: evaluate each claim against verified state at the time it was posted,
    // and against whether verified ever reached that claimed state.
    const finalVerifiedRank = stateRank(r.verifiedState);
    const ordered = [...itemEvents].sort((a, b) => a.at.localeCompare(b.at));
    for (const e of ordered) {
      if (e.kind !== "ClaimPosted") continue;
      const claimed = (e.data?.claimedState as LifecycleState | undefined);
      if (!claimed) continue;
      totalClaims++;
      const verifiedAt = verifiedRankAsOf(timeline, e.at);
      if (stateRank(claimed) > verifiedAt) aheadWhenPosted++;
      if (finalVerifiedRank >= stateRank(claimed)) substantiated++;
    }
  }

  // Funnel + flags
  const funnelMap = new Map<LifecycleState, number>();
  let outOfBounds = 0;
  let claimedNotVerified = 0;
  for (const { item } of reconciled) {
    funnelMap.set(item.verifiedState, (funnelMap.get(item.verifiedState) ?? 0) + 1);
    if (item.flags.includes("out-of-bounds")) outOfBounds++;
    if (item.flags.includes("claimed-not-verified")) claimedNotVerified++;
  }

  // Gate stats
  const gateMap = new Map<string, GateStat>();
  for (const { gates, satisfiedGates } of reconciled) {
    for (const g of gates) {
      const stat = gateMap.get(g.name) ?? { name: g.name, satisfiedBy: g.satisfiedBy, declaredOn: 0, satisfiedOn: 0, satisfactionRate: 0 };
      stat.declaredOn++;
      if (satisfiedGates.includes(g.name)) stat.satisfiedOn++;
      gateMap.set(g.name, stat);
    }
  }
  const gates = [...gateMap.values()].map((s) => ({
    ...s,
    satisfactionRate: s.declaredOn ? s.satisfiedOn / s.declaredOn : 0,
  }));

  // Stage timings
  const stageTimings: StageTiming[] = [...dwell.entries()].map(([state, samples]) => ({
    state,
    samples: samples.length,
    meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
    maxMs: Math.max(...samples),
  }));
  stageTimings.sort((a, b) => stateRank(a.state) - stateRank(b.state));
  const bottleneck = stageTimings.length
    ? stageTimings.reduce((m, s) => (s.meanMs > m.meanMs ? s : m))
    : undefined;

  return {
    generatedAt: new Date().toISOString(),
    scopeIntentId: opts.intentId,
    scopeIntentTitle,
    totalEvents: opts.intentId
      ? events.filter((e) => declared.some((i) => i.id === e.itemId)).length
      : events.length,
    totalItems: declared.length,
    funnel: [...funnelMap.entries()]
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => stateRank(a.state) - stateRank(b.state)),
    claims: {
      totalClaims,
      aheadWhenPosted,
      substantiated,
      unsubstantiated: totalClaims - substantiated,
      accuracy: totalClaims ? substantiated / totalClaims : 1,
      currentlyClaimedNotVerified: claimedNotVerified,
    },
    stageTimings,
    gates,
    flags: { outOfBounds, claimedNotVerified },
    bottleneck,
  };
}

/** Verified-state rank as of a given timestamp, from a precomputed timeline. */
function verifiedRankAsOf(timeline: TimelinePoint[], at: string): number {
  const t = Date.parse(at);
  let rank = stateRank(timeline[0]?.state ?? "declared");
  for (const p of timeline) {
    if (Date.parse(p.at) <= t) rank = stateRank(p.state);
    else break;
  }
  return rank;
}

/** Format a millisecond duration compactly (e.g. "850ms", "2.3s", "5.0m", "1.2h", "3.1d"). */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)}m`;
  const h = m / 60;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}
