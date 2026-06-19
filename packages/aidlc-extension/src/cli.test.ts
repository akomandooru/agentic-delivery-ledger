import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runCli } from "./cli.js";
import type { ResolvedApprover } from "./identity.js";

function tmpDb(): string {
  return join(tmpdir(), `adlx-test-${randomUUID()}`, "ledger.jsonl");
}

const fixedApprover: () => ResolvedApprover = () => ({
  subject: "alice@acme.com",
  name: "Alice",
  identityMethod: "git-commit-author",
});

/** Run a fixed, fully-specified (id+at) sequence so the output is deterministic. */
async function seed(db: string) {
  await runCli(["declare", "--db", db, "--item", "intent-1", "--type", "intent", "--title", "X", "--id", "e1", "--at", "2026-01-01T00:00:00.000Z"]);
  await runCli(["declare", "--db", db, "--item", "task-1", "--type", "task", "--parent", "intent-1", "--id", "e2", "--at", "2026-01-01T00:01:00.000Z"]);
  await runCli(["claim", "--db", db, "--item", "task-1", "--state", "awaiting_validation", "--actor", "kiro", "--id", "e3", "--at", "2026-01-01T00:02:00.000Z"]);
  await runCli(["ground-truth", "--db", db, "--item", "task-1", "--signal", "tests_passed", "--by", "adapter:github", "--evidence", "acme/repo#1", "--id", "e4", "--at", "2026-01-01T00:03:00.000Z"]);
}

describe("adlx CLI: append subcommands and the only-writer path", () => {
  it("declares, claims, and records ground truth, then verifies INTACT", async () => {
    const db = tmpDb();
    await seed(db);
    const v = await runCli(["verify", db]);
    expect(v.code).toBe(0);
    expect(v.stdout).toBe("INTACT (4 records)");
    rmSync(join(db, ".."), { recursive: true, force: true });
  });

  it("records a human gate as both GateSatisfied and a review_approved ground truth", async () => {
    const db = tmpDb();
    await runCli(["declare", "--db", db, "--item", "task-1", "--type", "task"]);
    const r = await runCli(["gate", "--db", db, "--item", "task-1", "--gate", "human-review"], {
      resolveApprover: fixedApprover,
    });
    expect(r.code).toBe(0);
    const lines = readFileSync(db, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    const kinds = lines.map((e) => e.kind);
    expect(kinds).toContain("GateSatisfied");
    expect(lines.find((e) => e.kind === "GateSatisfied")!.data.by).toBe("alice@acme.com");
    expect(lines.some((e) => e.kind === "GroundTruthObserved" && e.data.signal === "review_approved")).toBe(true);
    rmSync(join(db, ".."), { recursive: true, force: true });
  });
});

describe("adlx CLI: determinism and round-trip", () => {
  it("produces byte-identical ledger content for identical ordered inputs", async () => {
    const dbA = tmpDb();
    const dbB = tmpDb();
    await seed(dbA);
    await seed(dbB);
    expect(readFileSync(dbA, "utf-8")).toBe(readFileSync(dbB, "utf-8"));
    rmSync(join(dbA, ".."), { recursive: true, force: true });
    rmSync(join(dbB, ".."), { recursive: true, force: true });
  });

  it("round-trips: each appended line parses back to the recorded event", async () => {
    const db = tmpDb();
    await seed(db);
    const lines = readFileSync(db, "utf-8").trim().split("\n");
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0]).toMatchObject({ id: "e1", kind: "ItemDeclared", itemId: "intent-1" });
    expect(parsed[2]).toMatchObject({ id: "e3", kind: "ClaimPosted", data: { claimedState: "awaiting_validation" } });
    // re-serializing the parsed object reproduces the stored line
    expect(lines.map((l) => JSON.stringify(JSON.parse(l))).join("\n")).toBe(readFileSync(db, "utf-8").trim());
    rmSync(join(db, ".."), { recursive: true, force: true });
  });
});

describe("adlx CLI: validation leaves the ledger unchanged", () => {
  it("rejects a schema-invalid claim with a non-zero exit and writes nothing", async () => {
    const db = tmpDb();
    const r = await runCli(["claim", "--db", db, "--item", "task-1", "--state", "not-a-real-state"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("adlx:");
    expect(existsSync(db)).toBe(false);
  });

  it("rejects disallowed content and writes nothing", async () => {
    const db = tmpDb();
    await runCli(["declare", "--db", db, "--item", "task-1", "--type", "task"]);
    const before = readFileSync(db, "utf-8");
    const r = await runCli(["ground-truth", "--db", db, "--item", "task-1", "--signal", "tests_passed", "--evidence", "a\nb"]);
    expect(r.code).toBe(2);
    expect(readFileSync(db, "utf-8")).toBe(before);
    rmSync(join(db, ".."), { recursive: true, force: true });
  });

  it("missing required flag is a usage error", async () => {
    const r = await runCli(["claim", "--state", "validated"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--item");
  });
});
