import { describe, it, expect } from "vitest";
import { RecordStore, project } from "@adl/core";
import { RecordEvent as RecordEventSchema, PROTOCOL_VERSION } from "@adl/protocol";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import {
  buildItemDeclared,
  buildClaim,
  buildGroundTruth,
  type EventInput,
} from "./record.js";

function tmpDb(): string {
  return join(tmpdir(), `adlx-conf-${randomUUID()}`, "ledger.jsonl");
}

function append(store: RecordStore, input: EventInput) {
  return store.append({
    kind: input.kind,
    itemId: input.itemId,
    actor: input.actor,
    trustLevel: input.trustLevel,
    data: input.data,
    ...(input.id ? { id: input.id } : {}),
    ...(input.at ? { at: input.at } : {}),
  });
}

function itemById(store: RecordStore, id: string) {
  return project(store).find((i) => i.id === id)!;
}

describe("conformance: PROTOCOL.md section 5 worked example", () => {
  it("reports claimed-not-verified after the claim, then validated after tests + human review", () => {
    const db = tmpDb();
    const store = new RecordStore(db);

    // intent-1 with a human gate; task-1 under it with an automated tests gate.
    append(store, buildItemDeclared({ itemId: "intent-1", actor: "pm@acme", type: "intent", title: "Customer data export", gates: [{ name: "intent-approval", satisfiedBy: "human" }] }));
    append(store, buildItemDeclared({ itemId: "task-1", actor: "planner", type: "task", parentId: "intent-1", title: "POST /export", gates: [{ name: "tests-pass", satisfiedBy: "automated" }] }));

    // agent claims it is done
    append(store, buildClaim({ itemId: "task-1", actor: "kiro", claimedState: "awaiting_validation" }));

    const afterClaim = itemById(store, "task-1");
    expect(afterClaim.flags).toContain("claimed-not-verified");
    expect(afterClaim.verifiedState).not.toBe("validated");

    // ground truth lands: tests pass, then a human approves
    append(store, buildGroundTruth({ itemId: "task-1", actor: "adapter:github", signal: "tests_passed", evidence: "acme/repo#1" }));
    append(store, buildGroundTruth({ itemId: "task-1", actor: "reviewer@acme", signal: "review_approved", evidence: "gate:intent-approval", trustLevel: "L3" }));

    const afterTruth = itemById(store, "task-1");
    expect(afterTruth.verifiedState).toBe("validated");
    expect(afterTruth.flags).not.toContain("claimed-not-verified");

    rmSync(join(db, ".."), { recursive: true, force: true });
  });

  it("every produced event validates against the protocol schema and records protocol version 0.1.0", () => {
    const db = tmpDb();
    const store = new RecordStore(db);
    append(store, buildItemDeclared({ itemId: "intent-1", actor: "pm", type: "intent" }));
    append(store, buildClaim({ itemId: "intent-1", actor: "kiro", claimedState: "in_progress" }));

    for (const e of store.all()) {
      expect(() => RecordEventSchema.parse(e)).not.toThrow();
    }
    const genesis = store.all()[0];
    expect((genesis.data as Record<string, unknown>).protocolVersion).toBe(PROTOCOL_VERSION);
    expect(PROTOCOL_VERSION).toBe("0.1.0");

    rmSync(join(db, ".."), { recursive: true, force: true });
  });
});
