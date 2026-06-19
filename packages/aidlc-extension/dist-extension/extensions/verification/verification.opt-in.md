# Verification Ledger — Opt-In

**Extension**: Verification Ledger

## Opt-In Prompt

The following question is automatically included in the Requirements Analysis clarifying questions when this extension is loaded:

```markdown
## Question: Verification Ledger
Should this project record a tamper-evident, claimed-versus-verified ledger of the AI-DLC run?

A) Yes — record every work item, agent claim, observed ground truth, and human gate into a hash-chained ledger (`aidlc-docs/ledger.jsonl`) via the `adlx` tool, and block a stage gate until the item's claim and verification status are recorded (recommended for regulated or audited delivery)

B) No — skip verification recording (suitable for PoCs, prototypes, and experimental projects)

X) Other (please describe after [Answer]: tag below)

[Answer]: 
```
