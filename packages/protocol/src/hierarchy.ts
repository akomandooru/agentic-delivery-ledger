import type { Boundaries, Gate, WorkItem } from "./schema.js";

/**
 * Inheritance and roll-up — the keystone of the model.
 *
 * Purpose, boundaries, and gates live on the intent. Children (epics/features/tasks)
 * and nested intents inherit them; they are never re-declared per item. Roll-up walks
 * the parent chain so audit queries by intent return every contributing item.
 */

export type ItemIndex = Map<string, WorkItem>;

export function indexItems(items: WorkItem[]): ItemIndex {
  return new Map(items.map((i) => [i.id, i]));
}

/** Ancestor chain from the item's parent up to the root (excludes the item itself). */
export function ancestors(itemId: string, index: ItemIndex): WorkItem[] {
  const chain: WorkItem[] = [];
  let current = index.get(itemId);
  const seen = new Set<string>([itemId]);
  while (current?.parentId) {
    const parent = index.get(current.parentId);
    if (!parent || seen.has(parent.id)) break; // missing or cycle guard
    chain.push(parent);
    seen.add(parent.id);
    current = parent;
  }
  return chain;
}

/**
 * Effective boundaries = union of the item's own and all ancestors'.
 * Deny always wins: a denied path stays denied even if some level allows it.
 */
export function effectiveBoundaries(itemId: string, index: ItemIndex): Boundaries {
  const item = index.get(itemId);
  const levels = [item, ...ancestors(itemId, index)].filter(Boolean) as WorkItem[];
  const allow = new Set<string>();
  const deny = new Set<string>();
  for (const lvl of levels) {
    for (const a of lvl.boundaries?.allow ?? []) allow.add(a);
    for (const d of lvl.boundaries?.deny ?? []) deny.add(d);
  }
  // deny wins: drop any allow that is explicitly denied
  for (const d of deny) allow.delete(d);
  return { allow: [...allow], deny: [...deny] };
}

/** Effective gates = union (by name) of the item's own and all ancestors' gates. */
export function effectiveGates(itemId: string, index: ItemIndex): Gate[] {
  const item = index.get(itemId);
  const levels = [item, ...ancestors(itemId, index)].filter(Boolean) as WorkItem[];
  const byName = new Map<string, Gate>();
  for (const lvl of levels) {
    for (const g of lvl.gates ?? []) {
      if (!byName.has(g.name)) byName.set(g.name, g);
    }
  }
  return [...byName.values()];
}

/** The nearest ancestor (or self) that is an intent — the governing intent. */
export function owningIntent(itemId: string, index: ItemIndex): WorkItem | undefined {
  const item = index.get(itemId);
  if (!item) return undefined;
  if (item.type === "intent") return item;
  return ancestors(itemId, index).find((a) => a.type === "intent");
}

/** All descendants of an item (for roll-up: "everything done for intent X"). */
export function descendants(itemId: string, index: ItemIndex): WorkItem[] {
  const out: WorkItem[] = [];
  const children = [...index.values()].filter((i) => i.parentId === itemId);
  for (const child of children) {
    out.push(child, ...descendants(child.id, index));
  }
  return out;
}
