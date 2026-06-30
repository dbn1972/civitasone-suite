# Prompt 05 — Archival & NAI Transfer (Public Records Act 1993)

## Baseline
Under the Public Records Act 1993 + Rules 1997, **Category-A (permanent)**
records of enduring value are **transferred to the National Archives of India
(NAI)** when they are **25 years old**. Archival is a **distinct lifecycle stage**
from closure and from weeding, with its own register and transfer memo.

## What to verify in code
- Is archival distinct from `close`?
- Is there a Cat-A → NAI transfer task at 25 years and an archival register?

## Gap (from current code)
`status='archived'` exists only as an enum value. **No archival workflow, no NAI
transfer, no archival register.** Severity: **Medium** (≈40%).

## Remediation (R5)
- New `estab_archival (id, tenant_id, file_id, archived_at, archived_by,
  nai_eligible_at, nai_transferred_at, nai_reference, register_no, status
  (archived|nai_due|nai_transferred), remarks, …)`.
- `archive` command distinct from `close`: only Cat-A/permanent records become
  `nai_eligible`; compute `nai_eligible_at = closed_at + 25y`.
- Query `listNaiDue` for records past `nai_eligible_at` not yet transferred.
- `recordNaiTransfer(file_id, nai_reference)` stamps transfer + register no.

## Test plan
- Archive a Cat-A file → `nai_eligible_at` = +25y; non-Cat-A not eligible.
- `listNaiDue` returns only past-eligibility, untransferred files.
