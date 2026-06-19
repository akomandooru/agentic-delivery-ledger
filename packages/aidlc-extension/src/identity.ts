import { execFileSync } from "node:child_process";
import { verifyIdentity, type Identity } from "@adl/core";

/**
 * Git-identity resolution for human gates.
 *
 * A human gate must be bound to a real, recorded person, not an anonymous click. v1 derives the
 * approver from the git commit author of the commit associated with the approval, and runs it
 * through the `@adl/core` IdentityVerifier seam (the v1 shape-check). Production swaps in a real
 * verifier (OIDC/SSO) behind the same seam with no change here.
 *
 * If no identity is resolvable, this throws: a gate without a resolvable identity is not
 * satisfied, so nothing is recorded and the gate cannot be marked passed.
 */
export class IdentityError extends Error {}

export interface ResolvedApprover {
  /** stable subject id (the git author email) */
  subject: string;
  /** display name, if present */
  name?: string;
  /** how the identity was established */
  identityMethod: string;
}

/** A resolver seam so the CLI/tests can inject identity without shelling out to git. */
export type ApproverResolver = (opts?: { cwd?: string; commit?: string }) => ResolvedApprover;

/** Resolve the approver from the git commit author of `commit` (default HEAD). */
export function resolveGitAuthor(opts?: { cwd?: string; commit?: string }): ResolvedApprover {
  const commit = opts?.commit ?? "HEAD";
  let raw: string;
  try {
    raw = execFileSync("git", ["log", "-1", "--format=%an <%ae>", commit], {
      cwd: opts?.cwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    throw new IdentityError(
      "could not resolve a git commit author for the approval; a gate without a resolvable identity is not satisfied",
    );
  }
  const m = raw.match(/^(.*) <(.*)>$/);
  const email = m?.[2]?.trim();
  const name = m?.[1]?.trim() || undefined;
  if (!email) {
    throw new IdentityError(
      "git commit author email is empty; cannot bind the gate approval to an identity",
    );
  }
  // Validate the identity shape through the @adl/core seam (production swaps a real verifier).
  const verified: Identity = verifyIdentity({ subject: email, method: "token", name });
  return { subject: verified.subject, name: verified.name, identityMethod: "git-commit-author" };
}
