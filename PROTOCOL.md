# Agentic Delivery Ledger Protocol — v0.1

A small, language-agnostic protocol for governing AI-assisted software delivery: what was
**intended**, whether agents stayed **in bounds**, and whether a human **validated** the result.
You can implement it in any language; the TypeScript code in this repo is one reference
implementation. The machine-readable schema is [`schema/ledger.schema.json`](schema/ledger.schema.json),
generated from the Zod types via `npm run schema` (so it never drifts from the implementation).

> Design rule that shapes everything: **agents post claims; authoritative state moves only on
> verified ground truth.** Metadata only — a conforming implementation MUST NOT store source code
> content in the ledger.

## 1. Concepts

- **Work item** — the unit tracked by the ledger. The governing item is an **intent**; epics,
  features, and tasks are decomposition under an intent.
- **Intent** — carries the governing fields: `purpose`, `boundaries`, `gates`. Children inherit
  these; they are not re-declared per item.
- **Claimed vs verified** — every item has two states: `claimedState` (what an agent asserts) and
  `verifiedState` (what ground truth confirms). Only `verifiedState` is authoritative.
- **Event** — the ledger is an append-only, hash-chained log of events. Current item state is a
  projection over events.
- **Trust level** — `L0`-`L4` (from the IETF AAT draft). Claims are low trust (L0/L1); ground
  truth and identity-bound human gates are higher (L2+).

## 2. Enumerations

**ItemType:** `intent` | `epic` | `feature` | `task`

**LifecycleState:** `candidate` | `clarifying` | `declared` | `proposed` | `in_progress` |
`awaiting_validation` | `validated` | `in_production` | `stabilized`
(ordered; later states rank higher)

**Flag:** `claimed-not-verified` | `out-of-bounds`

**EventKind:** `ItemDeclared` | `ClaimPosted` | `GroundTruthObserved` | `GateSatisfied` | `StateChanged`

**TrustLevel:** `L0` (no identity) | `L1` (self-signed) | `L2` (authority-signed) |
`L3` (mutual auth) | `L4` (mutual auth + revocation/monitoring)

## 3. Types

### Gate
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | e.g. `human-review`, `tests-pass` |
| `satisfiedBy` | `human` \| `automated` | yes | a `human` gate needs human ground truth |
| `description` | string | no | |

### Boundaries
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `allow` | string[] (globs) | no (default `[]`) | paths agents may modify |
| `deny` | string[] (globs) | no (default `[]`) | paths off-limits without explicit human approval |

### WorkItem
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | stable id |
| `type` | ItemType | yes | |
| `parentId` | string | no | hierarchy + roll-up |
| `title` | string | yes | |
| `purpose` | string | no | intents: what the work is for |
| `boundaries` | Boundaries | no | intents; inherited by children |
| `gates` | Gate[] | no | gates; inherited by children |
| `outcome` | string | no | observed result, distinct from intent |
| `claimedState` | LifecycleState | no | agent-asserted |
| `verifiedState` | LifecycleState | yes | ground-truth confirmed (authoritative) |
| `flags` | Flag[] | no (default `[]`) | |
| `createdAt` | string (RFC 3339) | yes | |
| `updatedAt` | string (RFC 3339) | yes | |

### RecordEvent (the on-the-wire / on-disk unit)
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | unique (UUIDv4 recommended) |
| `kind` | EventKind | yes | |
| `itemId` | string | yes | the work item this event concerns |
| `at` | string (RFC 3339) | yes | event time |
| `actor` | string | yes | agent id, adapter name, or human identity |
| `trustLevel` | TrustLevel | no (default `L0`) | claims L0/L1; ground truth/human L2+ |
| `data` | object | no (default `{}`) | event-specific, metadata only |
| `prevHash` | string \| null | yes | SHA-256 over RFC 8785 (JCS) of the previous event; `null` for genesis |

Common `data` payloads:
- `ItemDeclared`: the work-item declaration (`type`, `title`, `parentId`, `purpose`,
  `boundaries`, `gates`, optional `initialState`).
- `ClaimPosted`: `{ claimedState }` (agent-asserted).
- `GroundTruthObserved`: `{ signal }` where signal is one of `pr_opened`, `review_approved`,
  `tests_passed`, `merged`, `deployed`, `stable`, `out_of_bounds`.
- `GateSatisfied`: `{ gate, by, identityMethod }` for an identity-bound human approval.

## 4. Rules (normative)

A conforming implementation MUST:

1. **Chain events.** Each event's `prevHash` MUST equal the SHA-256 of the RFC 8785 (JCS)
   canonical form of the previous event; the genesis event MUST have `prevHash = null`. Any
   modification to a past event breaks the chain and MUST be detectable.
2. **Never let a claim advance verified state.** A `ClaimPosted` event MAY set `claimedState`,
   but MUST NOT change `verifiedState`.
3. **Verify only from L2+ ground truth.** `verifiedState` advances only from `GroundTruthObserved`
   / `GateSatisfied` events at `trustLevel` L2 or higher.
4. **Require human ground truth for human gates.** A gate with `satisfiedBy: human` is satisfied
   only by an identity-bound, auditable human signal, never by an agent claim.
5. **Flag divergence.** If `claimedState` is ahead of `verifiedState`, the item MUST carry
   `claimed-not-verified`. If an agent acted outside `boundaries.deny`, it MUST carry
   `out-of-bounds`.
6. **Inherit down, roll up.** A child item's effective `boundaries` and `gates` are the union of
   its own and all ancestor intents' (deny wins over allow). Every non-intent item MUST be
   traceable to an owning intent.
7. **Metadata only.** No event `data` or export MAY contain source-code content.

## 5. Worked example (abridged)

```jsonl
{"id":"e1","kind":"ItemDeclared","itemId":"intent-1","at":"2026-01-01T00:00:00Z","actor":"pm@acme","trustLevel":"L3","data":{"type":"intent","title":"Customer data export","gates":[{"name":"intent-approval","satisfiedBy":"human"}],"initialState":"candidate"},"prevHash":null}
{"id":"e2","kind":"GateSatisfied","itemId":"intent-1","at":"2026-01-01T00:01:00Z","actor":"pm@acme","trustLevel":"L3","data":{"gate":"intent-approval","by":"pm@acme","identityMethod":"sso"},"prevHash":"<sha256(e1)>"}
{"id":"e3","kind":"ItemDeclared","itemId":"task-1","at":"2026-01-01T00:02:00Z","actor":"planner","trustLevel":"L2","data":{"type":"task","parentId":"intent-1","title":"POST /export","gates":[{"name":"tests-pass","satisfiedBy":"automated"}]},"prevHash":"<sha256(e2)>"}
{"id":"e4","kind":"ClaimPosted","itemId":"task-1","at":"2026-01-01T00:03:00Z","actor":"kiro","trustLevel":"L1","data":{"claimedState":"awaiting_validation"},"prevHash":"<sha256(e3)>"}
{"id":"e5","kind":"GroundTruthObserved","itemId":"task-1","at":"2026-01-01T00:04:00Z","actor":"adapter:github","trustLevel":"L2","data":{"signal":"tests_passed"},"prevHash":"<sha256(e4)>"}
{"id":"e6","kind":"GroundTruthObserved","itemId":"task-1","at":"2026-01-01T00:05:00Z","actor":"reviewer@acme","trustLevel":"L3","data":{"signal":"review_approved"},"prevHash":"<sha256(e5)>"}
```

After `e4`, `task-1` is `claimed-not-verified` (claim says done, no ground truth). After `e5`+`e6`
(tests + human review), its gates are satisfied and `verifiedState` becomes `validated`. The
claim never validated it; ground truth did.

## 6. Versioning

`PROTOCOL_VERSION` is `0.1.0`. Backward-incompatible changes increment the major version and are
recorded in `CHANGELOG.md`. v0.1 is intentionally minimal; expect fields to be added.

## 7. Relationship to standards

This protocol is a domain profile of the IETF Agent Audit Trail (AAT) draft (record conventions,
hash chaining, trust levels, `human_override`) and the OpenKedge IEEC model (intent → boundaries
→ outcome), applied to software delivery. See [`STANDARDS.md`](STANDARDS.md).
