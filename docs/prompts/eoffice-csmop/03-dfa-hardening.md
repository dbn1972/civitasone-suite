# Prompt 03 — Drafting / DFA Hardening (CSMOP "Drafting")

## CSMOP baseline
A **Draft for Approval (DFA)** is prepared on the file, may go through several
**revisions** (the approving officer returns it with comments), and once approved
becomes the **fair copy** for issue. Standard **draft templates** (Office
Memorandum, D.O. letter, sanction order, notification) speed drafting. Every
issued communication carries a **gapless reference number**.

## What to verify in code
- Is the DFA number **gapless** (per the file/dispatch pattern) or random?
- Are draft **revisions/versions** retained with comments?
- Is there a **template library** for standard communication types?

## Gap (from current code)
- `nextDfaNo()` uses `Math.random()` — **not gapless**, collision-prone, and not
  auditable as a register. Severity contribution: **High**.
- No `estab_dfa_version` (revisions lost on edit).
- No `estab_dfa_template` library.

## Remediation (R3)
1. **Gapless DFA number** — allocate in the consumer transaction via
   `files.estab_doc_seq` with series `dfa:<TYPE>` and format
   `DFA/<TYPE>/<year>/<5-digit>`. Remove `Math.random()` from `domain.ts`;
   the route returns 202 with the `id` (number is discoverable via query, same
   as files/dispatch). Keep a pure `formatDfaNo(type, year, seq)` helper.
2. **Draft versioning** — `estab_dfa_version (id, tenant_id, dfa_id, rev_no,
   subject, body, comment, created_at/by)`; snapshot on every `update` while
   editable and on `return`.
3. (Deferred to R8) template library shared with eOffice parity.

## Test plan
- Two concurrent `dfaCreate` get consecutive gapless numbers, no collision.
- Editing a draft creates a new `rev_no`; return captures reviewer comment.
- Format assertion `DFA/LET/2026/00001`.
