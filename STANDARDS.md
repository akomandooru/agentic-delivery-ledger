# Standards Alignment: AAT / IEEC for Agentic Software Delivery

This project is a **domain profile**: it applies the emerging agent-audit / evidence-chain
standards to the software delivery lifecycle (SDLC), a domain those standards do not yet cover.
It does not invent a parallel standard.

## The standards in plain terms

If you have not met these before, here is the short version.

**IETF Agent Audit Trail (AAT)** is a proposed *standard format for logging what an AI agent
did*. Think of it as a tamper-evident logbook: each entry records who acted, what they did, and
the outcome, and each entry is cryptographically linked to the one before it (a hash chain), so
if anyone edits or removes a past entry, the chain visibly breaks. It also tags each entry with a
**trust level** (L0 = self-asserted, up to L4 = fully authenticated) and notes when a human
overrode or approved an action. Its goal is to make agent activity auditable for regulations like
the EU AI Act.

**OpenKedge / IEEC** (Intent-to-Execution Evidence Chain) is a proposed *way to govern what an
agent is allowed to do*. Instead of an agent acting directly, it first declares its **intent**;
that intent is checked against rules and boundaries; if approved it becomes a bounded
**contract**; and the whole path from intent to outcome is recorded as a linked **evidence
chain**. The point: you can later reconstruct not just *what* happened but *why it was allowed*.

In one line: **AAT standardizes the tamper-evident record; OpenKedge/IEEC standardizes the
intent → boundaries → outcome flow.** Both were designed mainly for agents acting at runtime
(restarting services, calling APIs). This project applies the same two ideas to *software
delivery work* instead.

## Standards we build on

- **IETF Agent Audit Trail (AAT)** — `draft-sharif-agent-audit-trail`. A JSON record format for
  autonomous agents with tamper-evident SHA-256 hash chaining (RFC 8785 JCS canonicalization),
  optional ECDSA signatures, a `trust_level` (L0-L4) field, `human_override`, session structure,
  and EU AI Act / SOC 2 / ISO 42001 / PCI mappings.
  Official source: https://datatracker.ietf.org/doc/draft-sharif-agent-audit-trail/
- **OpenKedge / IEEC** — Governs agentic *mutation* via intent proposals → execution contracts →
  an Intent-to-Execution Evidence Chain linking intent → context → policy → bounds → outcome.
  Official source: https://arxiv.org/abs/2604.08601

## What we adopt

| Standard feature | How we use it |
|------------------|---------------|
| AAT hash chaining (SHA-256 + RFC 8785 JCS) | `prevHash` on every event; `verifyChain()` detects tampering (`packages/protocol/src/chain.ts`) |
| AAT `trust_level` (L0-L4) | `trustLevel` on every event; claims = L1, ground-truth/human = L3 |
| AAT `human_override` / `escalation` | human gate approvals recorded with verifiable identity |
| AAT genesis / ordered chain | first event has `prevHash = null`; each subsequent links to the prior |
| OpenKedge intent + execution contract | our `intent` purpose + `boundaries` + `gates` |
| OpenKedge IEEC (intent → outcome) | our intent → gates → verified outcome reconciliation |

## How claimed-vs-verified maps to trust levels

The core mechanic is expressed in standard terms:

- An agent **claim** (`ClaimPosted`, e.g. "done") is recorded at **L1** (self-asserted).
- **Ground truth** (`GroundTruthObserved`: tests passed, PR approved, merged) and human
  **gate approvals** (`GateSatisfied`) are recorded at **L3** (authority/ground-truth-backed).
- The reconciler advances **verified** state only from **L2+** records. A record below L2 — even
  one labeled as ground truth — cannot validate an item. This is the standards-native form of
  "a claim never moves verified state."

## Where we extend the standards (the domain profile)

1. **Domain = SDLC delivery, not production runtime.** AAT/OpenKedge target runtime agent actions
   (service restarts, config changes, autonomous decisions). We target delivery work: AI-written
   code moving from intent → validated → shipped → stabilized.
2. **Ground truth = the repository.** Our verification signals come from git/PR/CI (PR opened,
   review approved, checks passed, merged), not from the agent's own action log.
3. **Work-item model with inheritance + roll-up.** We add an intent/epic/feature/task hierarchy
   where children inherit boundaries and gates and roll up to their intent for audit. This is
   beyond AAT's per-action records.
4. **Tool-agnostic, multi-client.** One record, many MCP clients (Kiro, Q, Cursor); the standards
   are agent-framework-agnostic but do not specify the cross-tool delivery board.

## Not yet implemented (honest gaps vs. full AAT)

- **ECDSA signatures** (AAT optional): we implement hash chaining but not per-record signing yet.
- **Tombstone records** for GDPR Article 17 erasure: not implemented.
- **Syslog / CSV export** of the chain: we emit JSONL; other AAT export formats are future work.
- **IANA action-type registry conformance**: our event kinds are a domain set, not AAT's
  `tool_call`/`decision`/... taxonomy. A future mapping layer could translate between them.

## Why this matters

Aligning to AAT/IEEC means this reference implementation is **interoperable and audit-grade by
construction**, and positioned to ride (not fight) whatever standard emerges. The contribution is
demonstrating the SDLC-delivery profile of that standard — the part the ecosystem has not built.
