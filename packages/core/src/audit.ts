import { indexItems, owningIntent, descendants, effectiveGates, type WorkItem } from "@adl/protocol";
import type { RecordStore } from "./record-store.js";
import { project } from "./projection.js";

/**
 * Audit export — a byproduct of the record. Metadata only (no source code).
 *
 * For a given intent (scope), returns every contributing item (by roll-up), its verified state,
 * the gates that applied, which were satisfied, who/what satisfied them, and the evidence
 * references. This is the trail a compliance stakeholder hands an auditor.
 */
export interface GateAudit {
  name: string;
  satisfiedBy: "human" | "automated";
  satisfied: boolean;
  evidence: { actor: string; signal: string; ref?: string; at: string }[];
}

export interface ItemAudit {
  id: string;
  type: WorkItem["type"];
  title: string;
  verifiedState: string;
  flags: string[];
  gates: GateAudit[];
}

export interface AuditExport {
  intentId: string;
  intentTitle: string;
  generatedAt: string;
  items: ItemAudit[];
}

export function auditForIntent(store: RecordStore, intentId: string): AuditExport {
  const items = project(store);
  const index = indexItems(items);
  const intent = index.get(intentId);
  if (!intent) throw new Error(`Unknown intent: ${intentId}`);

  const scope = [intent, ...descendants(intentId, index)];
  const events = store.all();

  const itemAudits: ItemAudit[] = scope.map((item) => {
    const gates = effectiveGates(item.id, index);
    const gtEvents = events.filter(
      (e) => e.itemId === item.id && e.kind === "GroundTruthObserved",
    );
    const gateAudits: GateAudit[] = gates.map((g) => {
      const relevant = gtEvents.filter((e) => signalSatisfiesGate(g.name, g.satisfiedBy, String(e.data?.signal ?? "")));
      return {
        name: g.name,
        satisfiedBy: g.satisfiedBy,
        satisfied: relevant.length > 0,
        evidence: relevant.map((e) => ({
          actor: e.actor,
          signal: String(e.data?.signal ?? ""),
          ref: e.data?.evidence as string | undefined,
          at: e.at,
        })),
      };
    });
    return {
      id: item.id,
      type: item.type,
      title: item.title,
      verifiedState: item.verifiedState,
      flags: item.flags,
      gates: gateAudits,
    };
  });

  return {
    intentId,
    intentTitle: intent.title,
    generatedAt: new Date().toISOString(),
    items: itemAudits,
  };
}

function signalSatisfiesGate(gateName: string, satisfiedBy: string, signal: string): boolean {
  if (satisfiedBy === "human") return signal === "review_approved";
  if (gateName.toLowerCase().includes("test")) return signal === "tests_passed";
  return signal === "tests_passed" || signal === "merged";
}

// owningIntent re-exported for callers building scoped exports from an arbitrary item
export { owningIntent };
