import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GroundTruthAdapter, GroundTruthObservation } from "./ground-truth.js";
import type { GroundTruthSignal } from "../reconcile.js";

const execFileAsync = promisify(execFile);

/**
 * GitHub ground-truth adapter. Uses the `gh` CLI (read-only) to observe PR state and map it to
 * verified signals. Metadata only: PR number, review state, check conclusion, merge/closed.
 * Reads PR + reviews + checks via `gh`, never source code content.
 *
 * Item -> PR linkage: an item carries a `pr` mapping (itemId -> "owner/repo#number") provided
 * by the caller, since this reference implementation does not write back to git.
 */
export class GitHubAdapter implements GroundTruthAdapter {
  readonly name = "github";

  /** itemId -> "owner/repo#prNumber" */
  constructor(private readonly prByItem: Record<string, string>) {}

  async observe(itemIds: string[]): Promise<GroundTruthObservation[]> {
    const out: GroundTruthObservation[] = [];
    for (const itemId of itemIds) {
      const ref = this.prByItem[itemId];
      if (!ref) continue;
      const [repo, numStr] = ref.split("#");
      const number = Number(numStr);
      if (!repo || !Number.isFinite(number)) continue;

      try {
        const detail = await this.ghJson(repo, number);
        for (const sig of mapPrToSignals(detail)) {
          out.push({
            itemId,
            signal: sig,
            evidence: ref,
            at: new Date().toISOString(),
          });
        }
      } catch {
        // source unavailable for this item -> emit nothing (reconciler treats as unknown)
      }
    }
    return out;
  }

  private async ghJson(repo: string, number: number): Promise<PrDetail> {
    const { stdout } = await execFileAsync("gh", [
      "pr",
      "view",
      String(number),
      "--repo",
      repo,
      "--json",
      "state,reviews,statusCheckRollup,mergedAt",
    ]);
    return JSON.parse(stdout) as PrDetail;
  }
}

interface PrDetail {
  state?: string; // OPEN | MERGED | CLOSED
  mergedAt?: string | null;
  reviews?: { state?: string }[];
  statusCheckRollup?: { conclusion?: string; state?: string }[];
}

export function mapPrToSignals(pr: PrDetail): GroundTruthSignal[] {
  const signals: GroundTruthSignal[] = [];
  // a PR existing at all means work is in progress
  signals.push("pr_opened");

  const approved = (pr.reviews ?? []).some((r) => r.state === "APPROVED");
  if (approved) signals.push("review_approved");

  const checks = pr.statusCheckRollup ?? [];
  const allGreen =
    checks.length > 0 &&
    checks.every((c) => (c.conclusion ?? c.state ?? "").toUpperCase() === "SUCCESS");
  if (allGreen) signals.push("tests_passed");

  if (pr.state === "MERGED" || pr.mergedAt) signals.push("merged");

  return signals;
}
