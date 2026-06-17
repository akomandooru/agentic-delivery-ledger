import { z } from "zod";

/**
 * Agentic Delivery Ledger — protocol v0.1
 *
 * The published, language-agnostic schema. Defines work items, the intent/outcome
 * distinction, the lifecycle states, gates, and the keystone dual state
 * (claimed vs verified). Metadata only — no source code content.
 */

export const PROTOCOL_VERSION = "0.1.0";

export const ItemType = z.enum(["intent", "epic", "feature", "task"]);
export type ItemType = z.infer<typeof ItemType>;

export const LifecycleState = z.enum([
  "candidate",
  "clarifying",
  "declared",
  "proposed",
  "in_progress",
  "awaiting_validation",
  "validated",
  "in_production",
  "stabilized",
]);
export type LifecycleState = z.infer<typeof LifecycleState>;

export const Flag = z.enum(["claimed-not-verified", "out-of-bounds"]);
export type Flag = z.infer<typeof Flag>;

export const Gate = z.object({
  name: z.string(),
  satisfiedBy: z.enum(["human", "automated"]),
  description: z.string().optional(),
});
export type Gate = z.infer<typeof Gate>;

export const Boundaries = z.object({
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
});
export type Boundaries = z.infer<typeof Boundaries>;

export const WorkItem = z.object({
  id: z.string(),
  type: ItemType,
  parentId: z.string().optional(),
  title: z.string(),

  // intent-only governing fields; children inherit (not re-declared)
  purpose: z.string().optional(),
  boundaries: Boundaries.optional(),
  gates: z.array(Gate).optional(),

  // observed result, distinct from intent
  outcome: z.string().optional(),

  // the keystone: dual state
  claimedState: LifecycleState.optional(),
  verifiedState: LifecycleState,
  flags: z.array(Flag).default([]),

  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkItem = z.infer<typeof WorkItem>;

// ---- Events (the record is an append-only log of these) ------------------------------------

export const EventKind = z.enum([
  "ItemDeclared",
  "ClaimPosted",
  "GroundTruthObserved",
  "GateSatisfied",
  "StateChanged",
]);
export type EventKind = z.infer<typeof EventKind>;

/** AAT trust levels (L0-L4). Claims are low trust; ground-truth/human are higher. */
export const TrustLevel = z.enum(["L0", "L1", "L2", "L3", "L4"]);
export type TrustLevel = z.infer<typeof TrustLevel>;

export const RecordEvent = z.object({
  id: z.string(),
  kind: EventKind,
  itemId: z.string(),
  at: z.string(),
  /** who/what produced this event (agent id, adapter name, or human identity) */
  actor: z.string(),
  /** AAT trust level: claims = L0/L1, ground-truth/human = L2+ */
  trustLevel: TrustLevel.default("L0"),
  /** event-specific payload; metadata only, never source code */
  data: z.record(z.unknown()).default({}),
  /** SHA-256 over RFC 8785 JCS of the previous record; null for the genesis record */
  prevHash: z.string().nullable().default(null),
});
export type RecordEvent = z.infer<typeof RecordEvent>;
