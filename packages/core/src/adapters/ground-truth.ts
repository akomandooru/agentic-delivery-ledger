import type { GroundTruthSignal } from "../reconcile.js";

/**
 * Ground-truth adapter interface. Implementations observe an external source (a VCS, CI, etc.)
 * and emit signals about a work item. Metadata only — never source code content.
 *
 * The interface is deliberately small so other providers (GitLab, Bitbucket) can be added.
 */
export interface GroundTruthObservation {
  itemId: string;
  signal: GroundTruthSignal;
  /** who/what produced the underlying fact (e.g. an approver login), if known */
  by?: string;
  /** opaque reference to the evidence (PR number, run id) — metadata only */
  evidence?: string;
  at: string;
}

export interface GroundTruthAdapter {
  readonly name: string;
  /** Observe current ground truth for the given item ids. May return [] if unavailable. */
  observe(itemIds: string[]): Promise<GroundTruthObservation[]>;
}
