import {
  indexItems,
  effectiveGates,
  type ItemType,
  type WorkItem,
  type Boundaries,
  type Gate,
  type LifecycleState,
} from "@adl/protocol";
import { reconcile } from "./reconcile.js";
import { stateRank } from "./reconcile.js";
import type { RecordStore } from "./record-store.js";

/**
 * Projects the append-only event log into current WorkItem state.
 *
 * Pass 1: build declared items from ItemDeclared events.
 * Pass 2: reconcile each item (verified from ground truth, claimed overlay, flags), using
 *         effective (inherited) gates.
 */
export function project(store: RecordStore): WorkItem[] {
  const events = store.all();

  // Pass 1: declared items
  const declared = new Map<string, WorkItem>();
  for (const e of events) {
    if (e.kind === "ItemDeclared") {
      const d = e.data as Record<string, unknown>;
      declared.set(e.itemId, {
        id: e.itemId,
        type: (d.type as ItemType) ?? "task",
        parentId: d.parentId as string | undefined,
        title: (d.title as string) ?? e.itemId,
        purpose: d.purpose as string | undefined,
        boundaries: d.boundaries as Boundaries | undefined,
        gates: d.gates as Gate[] | undefined,
        outcome: d.outcome as string | undefined,
        verifiedState: (d.initialState as LifecycleState) ?? "declared",
        claimedState: undefined,
        flags: [],
        createdAt: e.at,
        updatedAt: e.at,
      });
    }
  }

  const index = indexItems([...declared.values()]);

  // Pass 2: reconcile each item using inherited gates
  const result: WorkItem[] = [];
  for (const item of declared.values()) {
    const gates = effectiveGates(item.id, index);
    const itemEvents = events.filter((e) => e.itemId === item.id);
    const r = reconcile({ declared: item, gates, events: [...itemEvents] });
    const lastAt = itemEvents.length ? itemEvents[itemEvents.length - 1].at : item.createdAt;
    result.push({
      ...item,
      verifiedState: r.verifiedState,
      claimedState: r.claimedState,
      flags: r.flags,
      updatedAt: lastAt,
    });
  }

  // Pass 3: roll-up. A parent (intent/epic/feature) has no work of its own; its verified state
  // is the LEAST-advanced state among its children (computed bottom-up). So a parent reaches
  // `stabilized` only once its whole subtree is stabilized, and it never claims to be further
  // along than the actual work beneath it. Leaf items (no children) keep their own state.
  rollUp(result);

  return result;
}

/** Overwrites each parent's verifiedState with the minimum (least-advanced) state of its children. */
function rollUp(items: WorkItem[]): void {
  const byId = new Map(items.map((i) => [i.id, i]));
  const childrenOf = new Map<string, WorkItem[]>();
  for (const i of items) {
    if (i.parentId && byId.has(i.parentId)) {
      if (!childrenOf.has(i.parentId)) childrenOf.set(i.parentId, []);
      childrenOf.get(i.parentId)!.push(i);
    }
  }
  const memo = new Map<string, LifecycleState>();
  const rolled = (id: string, seen: Set<string>): LifecycleState => {
    if (memo.has(id)) return memo.get(id)!;
    const item = byId.get(id)!;
    const kids = childrenOf.get(id);
    if (!kids || kids.length === 0 || seen.has(id)) {
      memo.set(id, item.verifiedState);
      return item.verifiedState;
    }
    seen.add(id);
    let min: LifecycleState | undefined;
    for (const k of kids) {
      const ks = rolled(k.id, seen);
      if (min === undefined || stateRank(ks) < stateRank(min)) min = ks;
    }
    seen.delete(id);
    const state = min ?? item.verifiedState;
    memo.set(id, state);
    return state;
  };
  for (const i of items) {
    if (childrenOf.has(i.id)) i.verifiedState = rolled(i.id, new Set());
  }
}
