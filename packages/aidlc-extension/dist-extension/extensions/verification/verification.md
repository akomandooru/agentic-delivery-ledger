# Verification Ledger Rules

## Overview
These rules give an AI-DLC run a tamper-evident, claimed-versus-verified system of record. They are MANDATORY cross-cutting constraints across all AI-DLC phases when this extension is enabled. They are not optional guidance: they are hard constraints that stages MUST enforce before presenting a stage completion message.

The single load-bearing rule: the ledger is written ONLY by the `adlx` tool. The model MAY run `adlx`, but MUST NEVER edit `aidlc-docs/ledger.jsonl` (or any ledger file) by hand. The ledger is metadata only: it MUST NOT contain source code, raw user input, verbatim model output, secrets, credentials, or PII.

**Invoking `adlx`**: you MUST actually execute these commands in the shell at the project root. Do not merely describe compliance, write it into `audit.md`, or claim a record was made. In this project `adlx` is wired through npm, so run `npm run adlx -- <args>` from the project root (if `adlx` is installed globally, run `adlx <args>` instead). The ledger file `aidlc-docs/ledger.jsonl` is created on the first successful `adlx` write, so it will not exist until you record the first item.

**Enforcement**: At each applicable stage, the model MUST verify compliance with these rules before presenting the stage completion message to the user.

### Blocking Verification Finding Behavior
A **blocking verification finding** means:
1. The finding MUST be listed in the stage completion message under a "Verification Findings" section with the VERIFY rule ID and description
2. The stage MUST NOT present the "Continue to Next Stage" option until all blocking findings are resolved
3. The model MUST present only the "Request Changes" option with a clear explanation of what needs to change
4. The finding MUST be recorded by running `adlx`, never by editing the ledger directly

### Default Enforcement
All rules in this document are **blocking** by default. If any rule's verification criteria are not met, it is a blocking verification finding.

---

## Rule VERIFY-01: Declare the Intent at Run Start and Every Work Item Thereafter

**Rule**: The intent MUST be declared in the ledger via `adlx declare` at the VERY START of the run, as soon as the intent is stated (during Workspace Detection or Requirements Analysis kickoff), BEFORE the first approval gate. Declare it with the AI-DLC human approval gates it will pass through as `satisfiedBy: human` gates (at minimum `requirements-approval` and `plan-approval`, plus any per-stage approvals the execution plan will include). Every unit/feature/task MUST then be declared at decomposition, each carrying its type, title, parent, and gates. This is the first `adlx` write of the run, so it happens before any stage is reported as approved.

**Verification**:
- `adlx report board` lists the intent from the first stage onward, and every unit of work after decomposition
- The intent declares its AI-DLC stage approvals as `satisfiedBy: human` gates
- Each declared item has the correct type and parent (units trace to the owning intent)

---

## Rule VERIFY-02: Record Agent Claims at Stage Completion

**Rule**: When the model reports a unit of work as complete, it MUST record a claim via `adlx claim --item <id> --state <lifecycleState>`. A claim is the model's assertion, not truth. The model MUST NOT claim `validated`; the furthest a claim may assert is `awaiting_validation`. Verified state is earned from ground truth and gates, never from a claim.

**Verification**:
- Every unit reported complete has a `ClaimPosted` event in `adlx report board`
- No claim asserts `validated`
- The model has not edited the ledger by hand (claims were recorded only via `adlx`)

---

## Rule VERIFY-03: Move Verified State Only on Observed Ground Truth

**Rule**: Verified state MUST advance only from ground truth observed from real tool output (tests, PR, CI), not from a signal the model merely asserts. Prefer, in order:
- `adlx verify-step --item <id> --pr <owner/repo#number>` to observe an independent PR/CI result (strongest: the source is outside the model's control);
- `adlx observe --item <id> --cmd "<test command>"`, which runs the test command and records `tests_passed` ONLY if it exits 0, binding the signal to a real local result;
- `adlx ground-truth` directly only when the signal genuinely came from observed tool output.

The model MUST NOT record a signal it did not observe from a real result.

**Verification**:
- Ground-truth events trace to real tool output (a PR/CI result or a test command that actually exited 0), not to a model assertion
- After tests run, the corresponding `tests_passed` ground truth is recorded via `adlx observe` or `adlx verify-step`
- No `GroundTruthObserved` event was created from an unverified assertion

---

## Rule VERIFY-04: Record Every Human Approval With Identity (Stage Gates and Work-Item Gates)

**Rule**: Every human approval in the run MUST be recorded via `adlx gate --item <id> --gate <name>`, which binds it to the git commit author, BEFORE that approval is reported as granted. This includes:
- each AI-DLC stage approval ("Approve and Continue") at the end of a stage (for example `requirements-approval`, `plan-approval`, and any per-stage approval in the execution plan), recorded against the intent;
- each work-item gate declared `satisfiedBy: human` (for example `human-review`), recorded against that unit.

The model MUST NOT report any stage or gate as approved on its own, and MUST NOT write the approval only into `audit.md`. `audit.md` is a narrative; the ledger is the verified record. A gate without a resolvable identity is treated as not satisfied.

**Verification**:
- Every AI-DLC stage approval that has occurred has a corresponding `GateSatisfied` event in the ledger bound to an identity
- Every human work-item gate presented as passed has a `GateSatisfied` event bound to an identity
- No approval recorded in `audit.md` is missing from the ledger
- The model did not self-approve any stage or gate

---

## Rule VERIFY-05: Single-Writer, Metadata-Only Ledger Integrity

**Rule**: The ledger is written ONLY by `adlx`. The model MUST NOT create, edit, or delete `aidlc-docs/ledger.jsonl` directly. No source code, raw input, verbatim output, secrets, credentials, or PII may be placed in the ledger.

**Verification**:
- The ledger was modified only through `adlx` invocations (no direct file edits)
- No ledger event `data` contains source code, secrets, credentials, or PII
- The ledger remains a single committed JSON Lines file at `aidlc-docs/ledger.jsonl`

---

## Rule VERIFY-06: Verify Ledger State and Chain Integrity at Each Gate

**Rule**: Before presenting a stage completion message, the model MUST confirm that the current unit's claim and verification status are recorded, and that the hash chain is intact, by running `adlx verify` and `adlx report board`.

**Verification**:
- `adlx verify` reports the ledger as INTACT (no broken records)
- `adlx report board` shows the current unit with its claim and verified state, and any `claimed-not-verified` divergence is surfaced to the user
- A unit still flagged `claimed-not-verified` is reported as a finding, not silently passed

---

## Rule VERIFY-07: Every Declared Unit Must Have a Satisfiable Verification Path

**Rule**: Every declared unit/feature/task MUST carry at least one gate that the work actually planned for it can satisfy. The choice of gate MUST match the verification that is planned:
- When automated verification (unit tests, CI, or a PR/CI result) IS planned for the unit, declare the corresponding automated gate (for example `tests-pass`, `satisfiedBy: automated`) and satisfy it from observed ground truth per VERIFY-03.
- When NO automated verification is planned for the unit, the unit MUST declare a human-review gate (`human-review`, `satisfiedBy: human`), so verified state still has a path to advance through an identity-bound human approval per VERIFY-04.

A unit MUST NOT be declared with only an automated gate (such as `tests-pass`) that the execution plan never intends to satisfy: that produces a unit which can never leave `claimed-not-verified`. If the testing decision for a unit is "no tests", the gate for that unit defaults to `human-review`.

**Verification**:
- Every declared unit has at least one gate
- Each unit with no planned automated verification declares a `satisfiedBy: human` gate (for example `human-review`)
- No unit carries an automated gate that the plan does not intend to satisfy with observed ground truth
- A unit that would reach the end of the run with no satisfiable gate is a blocking verification finding

---

## Enforcement Integration

These rules are cross-cutting constraints that apply to every AI-DLC stage. At each stage:
- Evaluate all VERIFY rule verification criteria against the artifacts and the ledger
- Include a "Verification Compliance" section in the stage completion summary listing each rule as compliant, non-compliant, or N/A
- If any rule is non-compliant, this is a blocking verification finding
- Record the run's claims, ground truth, and gates only through `adlx`, never by editing the ledger
