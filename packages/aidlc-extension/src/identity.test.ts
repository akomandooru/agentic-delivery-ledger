import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGitAuthor, IdentityError } from "./identity.js";

describe("identity: git author resolution for gates", () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "adlx-git-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "alice@acme.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Alice"], { cwd: repo });
    execFileSync("git", ["commit", "--allow-empty", "-m", "init", "-q"], { cwd: repo });
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("resolves the commit author as the approver identity", () => {
    const a = resolveGitAuthor({ cwd: repo });
    expect(a.subject).toBe("alice@acme.com");
    expect(a.name).toBe("Alice");
    expect(a.identityMethod).toBe("git-commit-author");
  });

  it("throws when no git identity is resolvable (gate cannot be satisfied)", () => {
    const notGit = mkdtempSync(join(tmpdir(), "adlx-notgit-"));
    expect(() => resolveGitAuthor({ cwd: notGit })).toThrow(IdentityError);
    rmSync(notGit, { recursive: true, force: true });
  });
});
