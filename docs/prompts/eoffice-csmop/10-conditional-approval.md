# Prompt 10 — Conditional / Partial Approval (Gap #10 / R10)

## CSMOP basis
CSMOP Ch. 6 (noting & disposal): an approving authority may **agree, disagree, return**, or
approve **subject to conditions / in part** (e.g. "approved for items 1–3 only", "approved
subject to finance concurrence"). The decision and its conditions must be recorded.

## What to verify
- `dfa/domain.ts` transitions — only `approved`/`returned`? No conditional/partial path.
- `estab_notings.action` — free text; no structured conditional-approval capture.

## Expected control
- DFA/noting approval captures `approval_disposition ∈ (full|conditional|partial)` and a
  `conditions` text/JSON when not full.
- Conditional/partial approval still advances state but records the qualifier in audit.

## Remediation (R10)
- Migration: add `approval_disposition` + `approval_conditions` to `estab_dfa` (+ noting).
- consumer: `dfaApprove` accepts optional disposition/conditions; audit records them.
- validators: when disposition ≠ full, conditions required.

## Acceptance check
- Approve a DFA `conditional` with conditions → stored + audited; `full` works as before.
- Missing conditions on conditional/partial rejected; typecheck + suite green.
