import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hashRecord, verifyChain, type ChainVerification, type RecordEvent, type TrustLevel } from "@adl/protocol";

/**
 * Append-only, hash-chained event log (the system of record), aligned with the IETF AAT draft.
 *
 * Stored as JSON Lines on disk (one event per line). Each event carries `prevHash` =
 * SHA-256 over the canonical JSON of the previous event, forming a tamper-evident chain from a
 * genesis record (prevHash = null). Current state is a projection over events (see
 * projection.ts), so the audit trail is the source of truth, not a side effect.
 *
 * Metadata only: callers must never place source-code content in event.data.
 */

/** Default AAT trust level by event kind: claims are self-asserted (L1); ground truth/human L3. */
function defaultTrust(kind: RecordEvent["kind"]): TrustLevel {
  switch (kind) {
    case "ClaimPosted":
      return "L1"; // agent self-asserted
    case "GroundTruthObserved":
    case "GateSatisfied":
      return "L3"; // authority / ground-truth / human-backed
    default:
      return "L2";
  }
}

export class RecordStore {
  private events: RecordEvent[] = [];

  constructor(private readonly path: string) {
    this.loadFromDisk();
  }

  /** (Re)load all events from disk. Safe to call anytime; used to sync across processes. */
  reload(): void {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (existsSync(this.path)) {
      const text = readFileSync(this.path, "utf-8");
      this.events = text
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as RecordEvent);
    } else {
      mkdirSync(dirname(this.path), { recursive: true });
      this.events = [];
    }
  }

  /** Append an event, linking it to the chain. Returns the stored event. */
  append(event: Omit<RecordEvent, "id" | "at" | "prevHash" | "trustLevel"> & {
    id?: string;
    at?: string;
    trustLevel?: TrustLevel;
  }): RecordEvent {
    // Re-sync from disk so the chain links to the true latest record, even when another
    // process (e.g. the MCP server launched by Kiro) has appended since we loaded.
    this.loadFromDisk();
    const prev = this.events.length ? this.events[this.events.length - 1] : null;
    const full: RecordEvent = {
      id: event.id ?? randomUUID(),
      at: event.at ?? new Date().toISOString(),
      kind: event.kind,
      itemId: event.itemId,
      actor: event.actor,
      trustLevel: event.trustLevel ?? defaultTrust(event.kind),
      data: event.data ?? {},
      prevHash: prev ? hashRecord(prev) : null,
    };
    appendFileSync(this.path, JSON.stringify(full) + "\n", "utf-8");
    this.events.push(full);
    return full;
  }

  /** All events in append order. */
  all(): readonly RecordEvent[] {
    return this.events;
  }

  /** Events for a single item, in order. */
  forItem(itemId: string): RecordEvent[] {
    return this.events.filter((e) => e.itemId === itemId);
  }

  /** Verify the tamper-evident hash chain over the whole log. */
  verify(): ChainVerification {
    return verifyChain(this.events);
  }
}
