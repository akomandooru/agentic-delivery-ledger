import {
  PROTOCOL_VERSION,
  RecordEvent as RecordEventSchema,
  LifecycleState as LifecycleStateSchema,
  type EventKind,
  type LifecycleState,
  type RecordEvent,
  type TrustLevel,
} from "@adl/protocol";

/**
 * Metadata-only event builder.
 *
 * Turns CLI argument shapes into protocol `RecordEvent` inputs. This module never writes the
 * ledger; it only constructs and validates the event that the `adlx` CLI hands to
 * `RecordStore.append`. It enforces the protocol's "metadata only" rule (no source code, raw
 * input, verbatim model output, secrets, credentials, or PII beyond an identity field).
 */

/** The append-input shape: id/at/prevHash are filled by the RecordStore at append time. */
export type EventInput = Pick<RecordEvent, "kind" | "itemId" | "actor" | "trustLevel" | "data"> & {
  id?: string;
  at?: string;
};

/** Raised when a builder is asked to record disallowed content. */
export class ContentError extends Error {}

/** Top-level `data` keys permitted per event kind. Anything else is rejected. */
const ALLOWED_DATA_KEYS: Record<EventKind, readonly string[]> = {
  ItemDeclared: ["type", "title", "parentId", "gates", "initialState", "purpose", "boundaries", "protocolVersion"],
  ClaimPosted: ["claimedState"],
  GroundTruthObserved: ["signal", "by", "evidence"],
  GateSatisfied: ["gate", "by", "identityMethod"],
  StateChanged: ["from", "to"],
};

/** Conservative patterns that indicate a secret, credential, or key has leaked into metadata. */
const SECRET_RE =
  /(-----BEGIN [A-Z ]*PRIVATE KEY-----|api[_-]?key\b|secret[_-]?key\b|(password|passwd|pwd)\s*[:=]|bearer\s+[A-Za-z0-9._-]{12,}|AKIA[0-9A-Z]{16})/i;

const MAX_STRING_LEN = 500;

function assertMetadataString(key: string, value: string): void {
  if (value.includes("\n")) {
    throw new ContentError(
      `field '${key}' contains multi-line content (possible source code or raw output); the ledger is metadata only`,
    );
  }
  if (value.length > MAX_STRING_LEN) {
    throw new ContentError(
      `field '${key}' exceeds the ${MAX_STRING_LEN}-char metadata limit; store an opaque reference, not content`,
    );
  }
  if (SECRET_RE.test(value)) {
    throw new ContentError(`field '${key}' looks like a secret or credential; the ledger is metadata only`);
  }
}

function assertMetadataValueDeep(key: string, value: unknown): void {
  if (typeof value === "string") {
    assertMetadataString(key, value);
  } else if (Array.isArray(value)) {
    for (const v of value) assertMetadataValueDeep(key, v);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertMetadataValueDeep(k, v);
    }
  }
}

/** Enforce the per-kind key allowlist and the metadata-only value rules. */
export function assertMetadataOnly(kind: EventKind, data: Record<string, unknown>): void {
  const allowed = ALLOWED_DATA_KEYS[kind];
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) {
      throw new ContentError(
        `field '${key}' is not an allowed metadata field for ${kind}; allowed: ${allowed.join(", ")}`,
      );
    }
    assertMetadataValueDeep(key, data[key]);
  }
}

/** Strip undefined values so canonicalization and round-trips are stable. */
function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Validate a constructed event input against the protocol schema and the metadata-only rules.
 * Returns the (schema-normalized) input, or throws on any violation, leaving the caller free to
 * abort before any write happens.
 */
export function validateEventInput(input: EventInput): EventInput {
  assertMetadataOnly(input.kind, input.data as Record<string, unknown>);
  // Construct a candidate full event with placeholders so the schema can validate kind,
  // trustLevel, itemId, actor, and the data shape. The real id/at/prevHash are set at append.
  const candidate = {
    id: input.id ?? "candidate",
    kind: input.kind,
    itemId: input.itemId,
    at: input.at ?? "1970-01-01T00:00:00.000Z",
    actor: input.actor,
    trustLevel: input.trustLevel,
    data: input.data,
    prevHash: null,
  };
  RecordEventSchema.parse(candidate);
  return input;
}

// ---- Builders ------------------------------------------------------------------------------

export interface DeclareArgs {
  itemId: string;
  actor: string;
  type: "intent" | "epic" | "feature" | "task";
  title?: string;
  parentId?: string;
  gates?: unknown[];
  initialState?: LifecycleState;
  id?: string;
  at?: string;
}

export function buildItemDeclared(args: DeclareArgs): EventInput {
  if (args.initialState !== undefined) LifecycleStateSchema.parse(args.initialState);
  return validateEventInput({
    kind: "ItemDeclared",
    itemId: args.itemId,
    actor: args.actor,
    trustLevel: "L2",
    id: args.id,
    at: args.at,
    data: clean({
      type: args.type,
      title: args.title ?? args.itemId,
      parentId: args.parentId,
      gates: args.gates,
      initialState: args.initialState,
      protocolVersion: PROTOCOL_VERSION,
    }),
  });
}

export interface ClaimArgs {
  itemId: string;
  actor: string;
  claimedState: LifecycleState;
  id?: string;
  at?: string;
}

export function buildClaim(args: ClaimArgs): EventInput {
  LifecycleStateSchema.parse(args.claimedState);
  return validateEventInput({
    kind: "ClaimPosted",
    itemId: args.itemId,
    actor: args.actor,
    trustLevel: "L1",
    id: args.id,
    at: args.at,
    data: { claimedState: args.claimedState },
  });
}

export interface GateArgs {
  itemId: string;
  gate: string;
  by: string;
  identityMethod: string;
  trustLevel?: TrustLevel;
  id?: string;
  at?: string;
}

export function buildGateSatisfied(args: GateArgs): EventInput {
  return validateEventInput({
    kind: "GateSatisfied",
    itemId: args.itemId,
    actor: args.by,
    trustLevel: args.trustLevel ?? "L3",
    id: args.id,
    at: args.at,
    data: { gate: args.gate, by: args.by, identityMethod: args.identityMethod },
  });
}

export interface GroundTruthArgs {
  itemId: string;
  actor: string;
  signal: string;
  evidence?: string;
  by?: string;
  trustLevel?: TrustLevel;
  id?: string;
  at?: string;
}

export function buildGroundTruth(args: GroundTruthArgs): EventInput {
  return validateEventInput({
    kind: "GroundTruthObserved",
    itemId: args.itemId,
    actor: args.actor,
    trustLevel: args.trustLevel ?? "L2",
    id: args.id,
    at: args.at,
    data: clean({ signal: args.signal, by: args.by, evidence: args.evidence }),
  });
}
