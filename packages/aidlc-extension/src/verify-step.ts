import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mapPrToSignals } from "@adl/core";
import { buildGroundTruth, type EventInput } from "./record.js";

/**
 * Ground-truth verification step.
 *
 * Runs at a gate. It invokes real tools (the `gh` CLI), maps their output to protocol signals via
 * `@adl/core`'s `mapPrToSignals`, and records one `GroundTruthObserved` event per observed signal.
 * Signals are derived only from tool output: nothing an agent asserts produces a ground-truth
 * event, and an unavailable tool yields no event (treated as unknown).
 */

const execFileAsync = promisify(execFile);

/** PR shape consumed by `mapPrToSignals` (metadata only). */
export interface PrDetailShape {
  state?: string;
  mergedAt?: string | null;
  reviews?: { state?: string }[];
  statusCheckRollup?: { conclusion?: string; state?: string }[];
}

/** Fetches PR metadata for a `owner/repo#number` reference, or null if unavailable. */
export type PrFetcher = (prRef: string) => Promise<PrDetailShape | null>;

export interface VerificationStepArgs {
  itemId: string;
  /** "owner/repo#number" */
  prRef: string;
  actor?: string;
  /** observes real tool output */
  fetchPr: PrFetcher;
  /** the only writer: validates and appends through the ledger */
  append: (input: EventInput) => void;
}

/**
 * Observe ground truth for an item from real tool output and record it. Returns the signals
 * recorded (empty if the tool was unavailable).
 */
export async function runVerificationStep(args: VerificationStepArgs): Promise<string[]> {
  const detail = await args.fetchPr(args.prRef);
  if (!detail) return []; // tool unavailable -> observe nothing
  const signals = mapPrToSignals(detail);
  for (const signal of signals) {
    args.append(
      buildGroundTruth({
        itemId: args.itemId,
        actor: args.actor ?? "adapter:github",
        signal,
        evidence: args.prRef,
      }),
    );
  }
  return signals;
}

/** Default fetcher: read-only `gh pr view`. Returns null if `gh` is missing or fails. */
export const ghFetchPr: PrFetcher = async (prRef) => {
  const [repo, numStr] = prRef.split("#");
  const number = Number(numStr);
  if (!repo || !Number.isFinite(number)) return null;
  try {
    const { stdout } = await execFileAsync("gh", [
      "pr",
      "view",
      String(number),
      "--repo",
      repo,
      "--json",
      "state,reviews,statusCheckRollup,mergedAt",
    ]);
    return JSON.parse(stdout) as PrDetailShape;
  } catch {
    return null;
  }
};
