import type { GroundTruthAdapter } from "./adapters/ground-truth.js";
import type { RecordStore } from "./record-store.js";

/**
 * Ground-truth ingest: the bridge from an adapter to the record.
 *
 * Observes ground truth for the given items and appends `GroundTruthObserved` events. These are
 * recorded at trust level L2+ (authority/ground-truth-backed) by the record store, so the
 * reconciler treats them as verified evidence — never as agent claims.
 *
 * De-dupes: a signal already present for an item is not re-appended.
 */
export async function ingest(
  store: RecordStore,
  adapter: GroundTruthAdapter,
  itemIds: string[],
): Promise<number> {
  const observations = await adapter.observe(itemIds);
  let appended = 0;
  for (const obs of observations) {
    const already = store
      .forItem(obs.itemId)
      .some((e) => e.kind === "GroundTruthObserved" && e.data?.signal === obs.signal);
    if (already) continue;
    store.append({
      kind: "GroundTruthObserved",
      itemId: obs.itemId,
      actor: `adapter:${adapter.name}`,
      trustLevel: "L2", // ground-truth source is authority-backed
      data: { signal: obs.signal, by: obs.by, evidence: obs.evidence },
    });
    appended++;
  }
  return appended;
}
