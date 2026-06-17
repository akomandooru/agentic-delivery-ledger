*Code review in the age of coding agents*

# When "done" is just a claim

**An accountable rubber stamp is worse than no review. When agents write the code, "done" becomes a claim instead of a fact, and the reviewer inherits the risk. Here is the mental model for why, and a small system that records the claim, refuses to let it move state, and shows you the gap.**

---

A tech lead on a team that had gone all-in on coding agents described the problem in a sentence: most of the code was no longer written by hand, it came out of agents as fast as a few people could prompt them, and their own job had quietly inverted from producing to reviewing. They had become the bottleneck. And underneath the workload was a sharper worry, policy required every change to be signed off by someone accountable, but a quick peer approval and the area owner's sign-off were being recorded as if they were the same thing. How do you review at the speed agents now produce, without either drowning or waving things through?

That is not a tooling complaint. It is the shape of a shift, and most teams are meeting it with instincts calibrated for a world that no longer exists.

## The mental model: one root change, two consequences, three implications

Keep this and you can derive the rest.

**The root change: agents now author the code.** For the whole history of software, a human produced the work and a human was accountable for it. That single fact moved. Everything else follows, and to be clear it is [already](https://big-agile.com/blog/who-owns-ai-generated-code-when-it-ships-building-a-chain-of-human-accountability) [well](https://bitloops.com/resources/governance/the-problem-with-ai-pull-request-reviews) [argued](https://arxiv.org/abs/2605.17548); take it as settled.

**Consequence A — verification is the bottleneck and the risk.** When code is generated in minutes, producing it is no longer scarce; confirming it does what was intended is. And review is the wrong place to catch the gap: teams rate AI-generated code as *higher* quality than human code at review, yet most report [more production incidents once it ships](https://newrelic.com/resources/report/2026-state-of-ai-coding). Looks-approved is not works. The word *velocity* misleads here, so split it: production velocity (code out the door) is now nearly free, while delivery velocity (verified work reaching done) is bounded by verification. Faster production does nothing for delivery unless verification keeps up.

**Consequence B — accountability moves from author to verifier.** An agent cannot be called into a post-mortem. Accountability does not vanish; it lands on whoever approves. The reviewer now carries what the author used to.

From those two, three things you must do differently:

1. **Earn trust from evidence, stop inheriting it.** "Looks good, I trust them" worked because there was a competent, accountable *them*. Now approval is an attestation the reviewer owns; it has to rest on ground truth, not deference.
2. **Weight approvals, and automate what is objective.** A self-check, a peer review, and an owner's sign-off are not interchangeable. Tests and security rules are machine-checkable; "is this good design?" is not. Spend scarce human judgment only where judgment is required.
3. **Measure verification, or it decays into a rubber stamp.** Throughput pressure plus reviewer accountability is the exact recipe for approving faster than you can judge, and a review you did not really do still gets recorded as an approval. That manufactured assurance is worse than skipping the review, because it is invisible until the incident or the audit.

How wide is the gap? AI coding-tool use sits near [97% with governance around 30%](https://www.prnewswire.com/news-releases/ai-coding-hits-97-enterprise-adoption-new-black-duck-study-shows-governance-is-the-roi-multiplier-302794103.html), and [~84% of organizations](https://cloudsecurityalliance.org/press-releases/2026/02/05/cloud-security-alliance-strata-survey-finds-that-enterprises-are-in-time-to-trust-phase-as-they-build-ai-autonomy-foundations) doubt they could pass an audit of agent behavior. The understanding is catching up; the scaffolding has not. (Figures paraphrased; follow the links.)

## The one rule worth implementing: a claim cannot move state

Everything above reduces to a single distinction. An agent saying "done," or even a verify-agent reporting "pass," is a **claim**. A passing test observed from CI, a human approval bound to a real identity, a merge observed from the VCS, that is **ground truth**. Most workflows blur the two: an agent reports done, the card slides to done. The blur is where false assurance lives.

So make the rule mechanical, not cultural: *a claim is recorded but cannot advance authoritative state. Only ground truth and identity-bound human approval can.* You make one undisciplined path, an agent's claim passing for verification, structurally unavailable. (The other path, a human approving without truly reviewing, no tool can close; more on that below.) Then you watch the first part work.

## See it run

The **[Agentic Delivery Ledger](https://github.com/akomandooru/agentic-delivery-ledger)** is a deliberately minimal reference implementation of exactly that rule, an append-only, hash-chained record that agents talk to through a small set of tools, with current state computed as a projection over the log. Clone it and step through the full lifecycle interactively:

```bash
git clone https://github.com/akomandooru/agentic-delivery-ledger
cd agentic-delivery-ledger
npm install
npm run journey
```

`npm run journey` pauses at each stage so you can advance it yourself, and it prints the exact command to launch the live board. Run that in a second terminal and open `http://localhost:4000` to watch the cards move as the record changes:

```bash
# the journey prints the precise command (with an absolute path) for your shell; it looks like:
ADL_DB=<absolute path to>/out/journey.jsonl PORT=4000 npm start -w @adl/board
```

The journey walks a single intent from a PM raising a need, through decomposition, to deployment and back into the loop. The stretch that matters is the middle, where the agent's claim meets ground truth.

**The agent claims and reports done.** You can drive this for real in Kiro (`claim_item`, then `update_status … done`) or let the journey mock it. Either way the ledger records `ClaimPosted` events and sets the *claimed* state, while verified state stays put. The `update_status` tool says it plainly: *"this is claimed, not verified; it will show as claimed-not-verified until ground truth confirms it."* The board shows the card in its real column with a claimed overlay and a `claimed-not-verified` flag, the state most boards never surface:

![A card the agent calls done, still unverified, flagged](board-claimed-not-verified.png)

This is the moment the whole piece is about. The agent did everything right and still cannot move the truth. The "done" is on the record, attributed, timestamped, and inert.

**Ground truth arrives, one observation at a time.** A PR is observed (`pr_opened`) and the card moves to *in progress*. CI passes (`tests_passed`) and it advances to *awaiting validation*, then stops, because a human-review gate is still open. A human approves, bound to a verifiable identity, recorded as ground truth, not as a claim. Both gates satisfied, the card becomes *validated* and the `claimed-not-verified` flag clears. (It keeps going from there, deploy and monitoring observations carry it to *in production* and *stabilized*, and a monitoring signal raises the next need, closing the loop.)

![The card validated only after real ground truth](validated.png)

The card became validated from tests plus a human approval, never from the agent's claim. That distinction is the whole point.

**It is provable after the fact, and the proof has teeth.** The log is a SHA-256 hash chain. Verify the ledger the journey wrote (`npm run verify` defaults to it) and it reports the chain intact:

```bash
npm run verify
# Tamper-evident chain: INTACT (N records)
```

A green "intact" is itself only a claim, so don't take it on faith, break it. Edit a single character inside any one line of `./out/journey.jsonl` and run it again:

```bash
npm run verify
# Tamper-evident chain: BROKEN at record N
```

![The verifier reporting the chain BROKEN at the first tampered record after a one-byte edit](verify.png)

That round-trip is the point: the record does not just assert it is untampered, it detects when it is.

**And because verification is the scarce thing, the ledger measures itself**, claim accuracy, where work waited, which gates actually fired, so "are we verifying or just approving" becomes a number rather than a vibe.

![Retro metrics on the verification process itself](retro.png)

## How the rule is enforced (and how far the enforcement goes)

The guarantee lives in one place, the reconciler. It reads every event, but claims only ever populate a "latest claim" overlay; verified state is advanced solely by ground-truth-typed observations, and human gates are satisfied only by a human approval signal. There is no code path where an agent claim advances verified state, and the agent-facing tools (`claim_item`, `update_status`) can emit nothing but claims. That is what "structural" means here: not policy, not convention, the move simply isn't reachable from the agent's side.

Be precise about the boundary, because the whole thesis is that claims should not be dressed up as more than they are. In this reference build the separation is enforced at the tool surface and by an event's declared type, not by cryptography. Human approval requires a verifiable identity, but that identity is supplied by the caller; in production it would be bound to real auth (SSO or a signed token). The hash chain gives tamper-*evidence*, not origin *authenticity*. So the claim is narrow and true: within the system's interface, an agent cannot move authoritative state with a claim. Hardening identity and origin to real auth is the obvious next step, not a solved one.

## What it does not do, and how it differs from branch protection

Be just as precise about the limit. The rule stops a *machine* claim from passing as verification. It does not stop a *human* from approving without reading, no system can, because none can confirm a brain engaged. An identity-bound approval and a reflexive click record the same event. So the honest scope is attribution and detection, not prevention: the approval is bound to an identity and written into a tamper-evident chain, so afterward you know who approved what, when, against which intent; and because the verification process is measured, the tells of a rubber stamp, approvals landing faster than a review could take, sign-offs on items whose tests never passed, one identity approving everything, surface in the retro instead of at the incident.

"Isn't this just branch protection?" For the merge moment, largely yes, and GitHub does it with real auth and hard enforcement: required reviewers, CODEOWNERS for whose approval counts, required status checks. If that is your whole workflow, you already have most of the gate, and a stronger one than this reference. The difference is scope and subject. Branch protection guards one event (the merge) in one tool, and it has no concept of an *agent's* claim. This sits above the tools as a system of record that treats every agent claim as inert until ground truth, including GitHub's own merge and check signals, confirms it; spans the whole lifecycle from intent approval to production stability, not just the PR; and measures the verification itself. It does not replace branch protection. It reconciles what agents *say* against what every tool, GitHub included, can *show*.

## What this is and is not

This is not a new idea. The accountability shift, the verification bottleneck, the velocity split, and tamper-evident audit trails for agents (see [TierZero](https://www.tierzero.ai/blog/ai-agent-audit-trail/), [RCPT](https://rcptprotocol.com/), [ChainProof](https://chainproof.ai/)) are all already in circulation, and the human judgment gate remains the real throughput throttle: you can automate objective ground truth, but irreducible judgment does not scale, and pretending it does is how the rubber stamp returns. The contribution here is narrow on purpose, one reconciliation rule, claimed versus verified, enforced rather than recommended, applied to the delivery lifecycle, with the verification itself measured. Small, runnable, and honest about its edges.

If the model lands, run it: [Agentic Delivery Ledger](https://github.com/akomandooru/agentic-delivery-ledger).

## Five moves you can make Monday (with or without this tool)

- Put security and tests on automated gates; treat their results as the only machine-verifiable ground truth.
- Reserve human review for the irreducible quality and design judgment.
- Write down whose approval counts for which areas, so an accountable sign-off is a defined role, not whoever clicks first.
- Pressure-test the spec before generating code; vague intent gives verification nothing to check against.
- Measure one thing: how often a "done" shipped without the evidence to back it. A number catches a rubber stamp before an auditor does.

## Back to the bottleneck

Return to the tech lead from the opening. What changes for them is narrower than they might hope, and more than they have today. The accountability their policy demands is finally provable: every sign-off is identity-bound and written into a record that survives the audit. A peer's quick approval and the owner's sign-off are no longer logged as the same event, you can see which was which (deciding the owner's is the one that *counts* stays the team's call; this minimal build records that distinction rather than enforcing it). An agent's "done" can no longer pass for their sign-off. And the thing they feared most, quietly waving changes through under load, stops being invisible: it surfaces as a number in the retro.

What does not change is the part that never could. They are still the reviewer; the judgment is still theirs, and judgment still does not scale. So be precise about which half of the opening this answers. *Waving things through* is solved: it can no longer happen silently, it surfaces as a number in the record. *Drowning* is not, this doc measures and bounds verification, but it does not reduce how much there is to verify. That lever is upstream, and it is the bigger half: a pressure-tested spec that gives review a target instead of forcing you to excavate intent from the diff, plus automating every deterministic check so human attention goes only where judgment is irreducible. That is its own piece, the companion doc [`foundations-comprehension-and-the-delivery-loop.md`](./foundations-comprehension-and-the-delivery-loop.md). Together they answer the whole question: specify well and judge at the gate, keep an agent's claim from ever passing for verified, and let everything in between be fast, governed, and measured.

---

## Sources

Industry figures are paraphrased from third-party 2026 reports; verify exact numbers at the primary sources before reuse. External articles linked in the text are paraphrased for licensing compliance; follow the links for their own words.

- AI coding-tool use ~97%, full governance ~30% — Black Duck / UserEvidence (2026): https://www.prnewswire.com/news-releases/ai-coding-hits-97-enterprise-adoption-new-black-duck-study-shows-governance-is-the-roi-multiplier-302794103.html
- ~84% doubt they could pass an audit of agent behavior — Cloud Security Alliance / Strata (2026): https://cloudsecurityalliance.org/press-releases/2026/02/05/cloud-security-alliance-strata-survey-finds-that-enterprises-are-in-time-to-trust-phase-as-they-build-ai-autonomy-foundations
- AI-generated code rated higher quality at review, yet ~78% report more production incidents after it ships — New Relic, 2026 State of AI Coding: https://newrelic.com/resources/report/2026-state-of-ai-coding
