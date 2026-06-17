import type { GroundTruthAdapter, GroundTruthObservation } from "./ground-truth.js";
import type { GroundTruthSignal } from "../reconcile.js";

/**
 * Mock ground-truth adapter. A drop-in for the GitHubAdapter that reads from an in-memory map
 * instead of a real repo, so the full journey can be run end to end with no external systems.
 *
 * It is still a *real adapter*: it only emits ground-truth signals you explicitly set on it
 * (simulating a PR being approved, CI passing, a merge, etc.). It does NOT let agents post
 * ground truth — the trust model is preserved; this just stands in for the external source.
 */
export class MockGroundTruthAdapter implements GroundTruthAdapter {
  readonly name: string;
  /** itemId -> ordered set of signals currently "true" for that item */
  private signals = new Map<string, Set<GroundTruthSignal>>();

  /** @param name the adapter identity recorded as the observing actor (e.g. "deployment"). */
  constructor(name = "mock") {
    this.name = name;
  }

  /** Simulate an external fact becoming true (e.g. a PR was approved). */
  set(itemId: string, signal: GroundTruthSignal): void {
    if (!this.signals.has(itemId)) this.signals.set(itemId, new Set());
    this.signals.get(itemId)!.add(signal);
  }

  async observe(itemIds: string[]): Promise<GroundTruthObservation[]> {
    const out: GroundTruthObservation[] = [];
    const now = new Date().toISOString();
    for (const itemId of itemIds) {
      for (const signal of this.signals.get(itemId) ?? []) {
        out.push({ itemId, signal, evidence: `mock:${itemId}`, at: now });
      }
    }
    return out;
  }
}
