# AI-DLC Verification Extension (`@adl/aidlc-extension`)

An opt-in, in-repo extension that gives an [AI-DLC](https://github.com/awslabs/aidlc-workflows)
run a tamper-evident, claimed-versus-verified system of record. It records every agent claim and
every human gate from a run into a hash-chained ledger committed to the repository, reconciles
those claims against real ground truth (PRs, CI, reviews), and shows the gap between what was
claimed and what was verified.

It does not fork or edit AI-DLC. It adds one tool (`adlx`) and one opt-in rule pack installed into
AI-DLC's own extensions slot. With the extension disabled, an AI-DLC run behaves exactly as it does
without it.

For the why (value, importance, design at a high level) see
[`docs/ai-dlc-verification-extension.md`](../../docs/ai-dlc-verification-extension.md). This README
is the how.

## How it works in one line

> Agents post **claims**. Authoritative state moves only on **verified** ground truth. A gate is
> never "passed" until the ledger records it. `adlx` is the only writer of the ledger.

It is a conforming implementation of the open protocol in [`PROTOCOL.md`](../../PROTOCOL.md): it
reuses `@adl/core` (the record store, reconciler, hash chain, and gate logic), so its records mean
the same thing as the standalone reference implementation and interoperate by construction.

## Harness support

This extension is **agent-agnostic, not Kiro-specific.** It rides entirely on AI-DLC's own
agent-agnostic machinery: the rule pack plugs into AI-DLC's extension system (scan `extensions/`,
present the opt-in during Requirements Analysis, enforce `VERIFY-NN` as blocking constraints), and
`adlx` is a plain Node CLI whose identity binding uses the **git** commit author and whose
`verify-step` uses the **`gh`** CLI — none of which is tied to a particular IDE. `adlx init`
installs the rule pack for Kiro, Amazon Q, Cursor, Cline, Copilot, and Codex layouts.

The one hard requirement is **shell access**: the entire trust model is the agent *executing*
`adlx` (the rules forbid merely describing compliance instead of running the tool). So:

- Harnesses with command execution (Kiro, Kiro CLI, Claude Code, Cline, Cursor, Amazon Q, Codex)
  can drive the ledger fully.
- Harnesses without command execution can read the rules but cannot write the ledger, so the
  extension cannot function there.

**Validation status:** the design is agnostic and its dependencies (AI-DLC extensions, git, a
shell) are agnostic, but the end-to-end path that has actually been exercised is **Kiro** (see the
`aidlc-verification-demo`). Treat other harnesses as "supported by construction, not yet
validated" until a run is confirmed on them.

## Install

`adlx` is the command-line tool. There are two ways to run it.

**From this workspace (development):**

```bash
npm install
npm run adlx -- --help                 # from the repo root
# or, scoped to the package:
npm run adlx -w @adl/aidlc-extension -- --help
```

**As a self-contained package (testing / distribution):** build a tarball and install it into any
project — no clone, no sibling repo. The bundle inlines `@adl/core`, `@adl/protocol`, and `zod`, so
it has zero runtime dependencies.

```bash
# 1. build + pack the tarball (from this package directory)
npm pack -w @adl/aidlc-extension        # -> adl-aidlc-extension-<version>.tgz (prepack builds dist/)

# 2. install it into the project you want to test in
npm i -D ../path/to/adl-aidlc-extension-0.1.0.tgz
#   or from a GitHub release asset:
#   npm i -D https://github.com/<org>/<repo>/releases/download/v0.1.0/adl-aidlc-extension-0.1.0.tgz

# 3. confirm and install the extension rules into the project
npx adlx --help
npx adlx init                           # auto-detects .kiro/.amazonq/.aidlc-rule-details; --ide / --dir to override
```

`adlx init` copies the rule pack (`verification.md`, `verification.opt-in.md`) into the project's
AI-DLC extensions slot at `aws-aidlc-rule-details/extensions/verification/baseline/`. It is
idempotent; pass `--force` (alias `--update`) to overwrite an existing install after a version bump.

The ledger defaults to `aidlc-docs/ledger.jsonl`, the same folder AI-DLC writes its generated docs
into, so it lands in the right place automatically. Override with `--db <path>` or `ADLX_DB`.

## Adopt it in an AI-DLC project

Two steps, neither of which modifies AI-DLC itself:

1. **Make `adlx` available** on the machine running the session — install the packaged tarball
   (`npm i -D adl-aidlc-extension-<version>.tgz`, then `npx adlx`), the `npm run adlx` workspace
   script above, or a global install once published.
2. **Install it as an AI-DLC extension.** Run `npx adlx init` to drop the rule pack into AI-DLC's
   extensions slot automatically, or copy it by hand: the two files from
   [`dist-extension/extensions/verification/`](dist-extension/extensions/verification)
   (`verification.md` and `verification.opt-in.md`) into
   `aws-aidlc-rule-details/extensions/verification/baseline/`. AI-DLC presents the opt-in during
   Requirements Analysis; answer Yes to enable it. Once enabled, its `VERIFY-NN` rules are blocking
   constraints that AI-DLC verifies at every stage, and that enforcement is what drives the `adlx`
   calls, including recording each human gate via `adlx gate` (bound to the git commit author) when
   you approve. No custom claim or gate hooks are needed.

A complete, runnable example of this install (real AI-DLC rules plus this extension) is in the
`aidlc-verification-demo` folder shipped alongside this repo.

## End to end in an AI-DLC project

The full lifecycle, from a fresh project to reading the verified record:

1. **Clone or open the project** you want to work in (greenfield or brownfield).
2. **Make `adlx` available** (install the packaged tarball and use `npx adlx`, an npm script
   pointing at this repo, or a global install once published). Confirm with `adlx --help`.
3. **Install the AI-DLC rules** the standard way for your agent. For Kiro: copy `aws-aidlc-rules`
   into `.kiro/steering/` and `aws-aidlc-rule-details` into `.kiro/`.
4. **Add the verification extension** with `npx adlx init` (or copy the two files from
   `dist-extension/extensions/verification/` into
   `aws-aidlc-rule-details/extensions/verification/baseline/`).
5. **Start a change**: in the agent, say "Using AI-DLC, <your change>", and answer **Yes** to the
   Verification Ledger opt-in during Requirements Analysis.
6. **Watch the ledger populate** as the run proceeds: the intent is declared at the start, each
   stage approval and human gate is recorded, claims are posted at stage completion, and ground
   truth is observed from tools. The ledger is `aidlc-docs/ledger.jsonl`.
7. **Read the verified record** with the report commands:
   ```bash
   adlx report board              # claimed vs verified, with claimed-not-verified divergence
   adlx report audit --intent <id> # the audit trail for an intent and its subtree
   adlx report retro              # claim accuracy, cycle time, gate effectiveness
   adlx verify                    # tamper-evidence: INTACT or BROKEN at a record index
   ```
   The standalone ledger repo also has a visual web board you can point at the ledger file.

`adlx` is packaged as a self-contained tarball (see Install) and `adlx init` drops the extension
rules into a project, so steps 2 and 4 are now a single command. Installing from a registry
(`npm i -D @adl/aidlc-extension`) instead of a tarball is the remaining follow-on once published.

## Commands

| Command | What it records / does |
|---------|------------------------|
| `adlx declare --item <id> --type <intent\|epic\|feature\|task> [--parent <id>] [--title <t>] [--gates <json>] [--initial <state>]` | Declares a work item (`ItemDeclared`). |
| `adlx claim --item <id> --state <lifecycleState> [--actor <agent>]` | Records an agent claim (`ClaimPosted`, low trust). |
| `adlx gate --item <id> --gate <name> [--commit <ref>]` | Records a human gate approval (`GateSatisfied`), bound to the git commit author. |
| `adlx ground-truth --item <id> --signal <signal> [--evidence <ref>] [--by <source>]` | Records an observed signal (`GroundTruthObserved`). |
| `adlx observe --item <id> --cmd "<test command>" [--signal <signal>]` | Runs the command and records the signal ONLY if it exits 0, so the signal is bound to a real result, not asserted. |
| `adlx verify-step --item <id> --pr <owner/repo#number>` | Observes a real PR via `gh` and records ground truth from its output. |
| `adlx verify [path]` | Walks the hash chain: prints `INTACT (N records)` or `BROKEN at record k`; exits 0 / 1. |
| `adlx report board\|retro\|audit [--intent <id>]` | Read-only projections over the ledger. |
| `adlx init [--ide <name>] [--dir <path>] [--force]` | Installs the extension rule pack into the project's AI-DLC extensions slot (auto-detects `.kiro`/`.amazonq`/`.aidlc-rule-details`). Idempotent; `--force` overwrites. |

Signals are the protocol set: `pr_opened`, `review_approved`, `tests_passed`, `merged`, `deployed`,
`stable`, `out_of_bounds`.

## Try it in 60 seconds

This mirrors a slice of an AI-DLC run in a throwaway git repo, with `adlx` driven by hand so you can
watch the trust model move. (In a real run, AI-DLC's verification rules make the agent issue these
calls.)

```bash
# a throwaway project repo
mkdir demo && cd demo
git init -q && git config user.email dev@example.com && git config user.name Dev
git commit --allow-empty -m "scaffold" -q
export ADLX_DB=aidlc-docs/ledger.jsonl
adlx() { node "<path-to-ledger-repo>/node_modules/tsx/dist/cli.mjs" \
               "<path-to-ledger-repo>/packages/aidlc-extension/src/cli.ts" "$@"; }

# 1. inception + decomposition
adlx declare --item intent-1 --type intent --title "Inventory API" \
     --gates '[{"name":"human-review","satisfiedBy":"human"}]'
adlx declare --item task-1 --type task --parent intent-1 --title "POST /items" \
     --gates '[{"name":"tests-pass","satisfiedBy":"automated"}]'

# 2. the agent claims it is done (overclaims "validated")
adlx claim --item task-1 --state validated --actor kiro
adlx report board       # task-1: claimed=validated, verified=declared, flag claimed-not-verified

# 3. tool-observed ground truth: tests pass
adlx ground-truth --item task-1 --signal tests_passed --by adapter:github --evidence inv/api#1
adlx report board       # verified -> awaiting_validation, still flagged (claim is still ahead)

# 4. a human approves the gate (bound to this repo's git author)
adlx gate --item task-1 --gate human-review
adlx report board       # verified -> validated, divergence cleared

# 5. integrity
adlx verify             # INTACT (6 records)
```

The agent's claim never advances verified state on its own. Verified moves only on tool-observed
ground truth and an identity-bound human gate, and the `claimed-not-verified` flag clears only when
verified catches up.

## Guarantees

- **Claims never advance verified state.** Verified state is a function only of L2+ ground truth
  and identity-bound human gates.
- **Human gates need human ground truth.** A `satisfiedBy: human` gate is satisfied only by an
  identity-bound approval, never by a claim.
- **Single writer.** Only `adlx` writes the ledger. The model may trigger it but never edits the
  ledger directly.
- **Tamper-evidence.** Every record is SHA-256 hash-chained (RFC 8785 JCS); altering any past
  record makes `adlx verify` report the first broken link.
- **Metadata only.** No source code, raw user input, verbatim model output, secrets, credentials,
  or PII is ever written. The builder rejects disallowed content before any write.
- **Opt-in isolation.** Disabled, the extension writes nothing and leaves AI-DLC's `audit.md`
  policy unchanged.

## Scope (v1)

v1 verifies at the gate and lifecycle-state level. Content-level binding of acceptance criteria as
the verification target, the hosted board / MCP scale-out, and real auth beyond the git-author
shape-check are deliberately out of v1 and tracked as follow-on increments.

## Tests

```bash
npx vitest run packages/aidlc-extension
```

Covers the metadata-only builder, CLI determinism and round-trip, git-identity resolution, the
verification step, the `PROTOCOL.md` section 5 conformance replay, tamper-evidence, and a scripted
end-to-end run.
