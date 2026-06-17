import type { RecordStore } from "../record-store.js";

/**
 * Seed the full lifecycle so the whole journey (Candidate -> Stabilized) is visible on the
 * board. Seeded items represent stages not yet implemented live; the LIVE slice
 * (execute -> validate, item "task-export-route") is driven separately by the demo via the
 * MCP server + ground truth, not seeded into a final state.
 *
 * Every seeded item is marked data.seeded = true so the board can distinguish it.
 */
export function seedFullJourney(store: RecordStore): void {
  const declare = (item: Record<string, unknown>) =>
    store.append({ kind: "ItemDeclared", itemId: item.id as string, actor: "seed", data: { ...item, seeded: true } });

  const gt = (itemId: string, signal: string) =>
    store.append({ kind: "GroundTruthObserved", itemId, actor: "seed", data: { signal, seeded: true } });

  // Top intent
  declare({
    id: "intent-gdpr",
    type: "intent",
    title: "Achieve GDPR compliance across the platform",
    purpose: "Meet GDPR obligations.",
    boundaries: { allow: ["regulated/**"], deny: ["infra/**"] },
    gates: [{ name: "legal-signoff", satisfiedBy: "human" }],
  });

  // Child intent (the one we work under)
  declare({
    id: "intent-export",
    type: "intent",
    parentId: "intent-gdpr",
    title: "Customer data export for GDPR compliance",
    purpose: "Let customers export their personal data in a portable format.",
    boundaries: { allow: ["services/export/**", "tests/export/**"], deny: ["services/billing/**", "services/auth/**"] },
    gates: [
      { name: "human-review", satisfiedBy: "human" },
      { name: "tests-pass", satisfiedBy: "automated" },
    ],
  });

  // Upstream stages, seeded as already-validated to show the full journey
  declare({ id: "epic-export-api", type: "epic", parentId: "intent-export", title: "Export API" });

  // A feature already in production (seeded)
  declare({ id: "feat-request-endpoint", type: "feature", parentId: "epic-export-api", title: "Export request endpoint" });
  gt("feat-request-endpoint", "pr_opened");
  gt("feat-request-endpoint", "tests_passed");
  gt("feat-request-endpoint", "review_approved");
  gt("feat-request-endpoint", "merged");
  gt("feat-request-endpoint", "stable");

  // A feature awaiting validation (seeded) — shows the bottleneck column
  declare({ id: "feat-data-aggregation", type: "feature", parentId: "epic-export-api", title: "Data aggregation" });
  gt("feat-data-aggregation", "pr_opened");
  gt("feat-data-aggregation", "tests_passed"); // tests pass but no human approval yet

  // The LIVE slice target: a task to be claimed/updated via Kiro in the demo.
  // Declared only; its progression comes from the live demo (MCP claims + ground truth).
  declare({
    id: "task-export-route",
    type: "task",
    parentId: "feat-data-aggregation",
    title: "POST /export route + validation",
  });

  // A downstream candidate raised from operations (seeded) — closes the loop
  declare({
    id: "intent-export-rate-spike",
    type: "intent",
    parentId: "intent-export",
    title: "Investigate export endpoint latency spike (from monitoring)",
    purpose: "Operational signal auto-created this candidate.",
  });
}
