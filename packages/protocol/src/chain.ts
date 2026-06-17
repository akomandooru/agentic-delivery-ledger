import { createHash } from "node:crypto";

/**
 * Tamper-evident hash chaining, aligned with the IETF Agent Audit Trail (AAT) draft.
 *
 * Records are linked by `prevHash = SHA-256(JCS(previous record))`. We implement the subset of
 * RFC 8785 (JSON Canonicalization Scheme) needed for the record shapes used here: objects with
 * string keys sorted lexicographically, arrays in order, and JSON string/number/boolean/null
 * primitives. This is sufficient for the metadata-only records in this protocol.
 */

/** Canonicalize a JSON value per a JCS-compatible subset (sorted object keys, UTF-8). */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "number") {
    if (!Number.isFinite(value as number)) throw new Error("Non-finite numbers are not allowed in canonical JSON");
    return JSON.stringify(value);
  }
  if (t === "boolean" || t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys
      .filter((k) => obj[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]));
    return "{" + parts.join(",") + "}";
  }
  throw new Error(`Cannot canonicalize value of type ${t}`);
}

/** SHA-256 (lowercase hex) of the canonical form of a value. */
export function hashRecord(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

export interface ChainVerification {
  ok: boolean;
  /** index of the first record whose prevHash does not match, or -1 if the chain is intact */
  brokenAt: number;
  message: string;
}

/**
 * Verify a hash chain. Each record (except the genesis at index 0) must carry
 * prevHash === hashRecord(previous record, excluding that previous record's own... no:
 * prevHash links to the FULL previous record as stored, minus nothing). The genesis record's
 * prevHash must be null.
 *
 * The hash of a record for chaining purposes excludes the record's own `prevHash`? No — per AAT,
 * prevHash(N) = hash of the COMPLETE record(N-1) including its prevHash. So we hash the previous
 * record exactly as stored.
 */
export function verifyChain(records: { prevHash: string | null }[]): ChainVerification {
  if (records.length === 0) return { ok: true, brokenAt: -1, message: "empty chain" };
  if (records[0].prevHash !== null) {
    return { ok: false, brokenAt: 0, message: "genesis record must have prevHash = null" };
  }
  for (let i = 1; i < records.length; i++) {
    const expected = hashRecord(records[i - 1]);
    if (records[i].prevHash !== expected) {
      return { ok: false, brokenAt: i, message: `chain broken at record ${i}: prevHash mismatch` };
    }
  }
  return { ok: true, brokenAt: -1, message: "chain intact" };
}
