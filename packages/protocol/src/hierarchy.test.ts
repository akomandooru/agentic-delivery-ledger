import { describe, it, expect } from "vitest";
import {
  indexItems,
  effectiveBoundaries,
  effectiveGates,
  owningIntent,
  descendants,
} from "./hierarchy.js";
import type { WorkItem } from "./schema.js";

const now = "2026-01-01T00:00:00.000Z";

function item(partial: Partial<WorkItem> & Pick<WorkItem, "id" | "type">): WorkItem {
  return {
    title: partial.id,
    flags: [],
    verifiedState: "declared",
    createdAt: now,
    updatedAt: now,
    ...partial,
  } as WorkItem;
}

describe("inheritance and roll-up (the keystone)", () => {
  const items: WorkItem[] = [
    item({
      id: "gdpr",
      type: "intent",
      boundaries: { allow: ["regulated/**"], deny: ["infra/**"] },
      gates: [{ name: "legal-signoff", satisfiedBy: "human" }],
    }),
    item({
      id: "export",
      type: "intent",
      parentId: "gdpr",
      boundaries: { allow: ["services/export/**"], deny: ["services/billing/**"] },
      gates: [
        { name: "human-review", satisfiedBy: "human" },
        { name: "tests-pass", satisfiedBy: "automated" },
      ],
    }),
    item({ id: "epic-api", type: "epic", parentId: "export" }),
    item({ id: "task-route", type: "task", parentId: "epic-api" }),
  ];
  const index = indexItems(items);

  it("a task inherits boundaries from all ancestor intents", () => {
    const b = effectiveBoundaries("task-route", index);
    expect(b.allow).toEqual(expect.arrayContaining(["services/export/**", "regulated/**"]));
    expect(b.deny).toEqual(expect.arrayContaining(["services/billing/**", "infra/**"]));
  });

  it("deny wins over allow across levels", () => {
    const items2 = [
      item({ id: "p", type: "intent", boundaries: { allow: ["x/**"], deny: [] } }),
      item({ id: "c", type: "task", parentId: "p", boundaries: { allow: [], deny: ["x/**"] } }),
    ];
    const b = effectiveBoundaries("c", indexItems(items2));
    expect(b.deny).toContain("x/**");
    expect(b.allow).not.toContain("x/**");
  });

  it("a task inherits gates from all ancestor intents (union by name)", () => {
    const gates = effectiveGates("task-route", index).map((g) => g.name).sort();
    expect(gates).toEqual(["human-review", "legal-signoff", "tests-pass"]);
  });

  it("resolves the owning (nearest) intent", () => {
    expect(owningIntent("task-route", index)?.id).toBe("export");
    expect(owningIntent("gdpr", index)?.id).toBe("gdpr");
  });

  it("rolls up: descendants of the top intent include all contributing items", () => {
    const ids = descendants("gdpr", index).map((i) => i.id).sort();
    expect(ids).toEqual(["epic-api", "export", "task-route"]);
  });

  it("guards against cycles", () => {
    const cyclic = [
      item({ id: "a", type: "intent", parentId: "b" }),
      item({ id: "b", type: "intent", parentId: "a" }),
    ];
    // should not infinite-loop
    expect(() => effectiveGates("a", indexItems(cyclic))).not.toThrow();
  });
});
