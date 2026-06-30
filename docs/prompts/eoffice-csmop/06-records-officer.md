# Prompt 06 — Records Officer & Annual Review (Public Records Rules 1997)

## Baseline
Every records-creating agency nominates a **Records Officer** responsible for
records management, **annual review** of records due for retention review, proper
**weeding**, and **NAI transfer**. The annual review produces a register of files
whose `review_due_date` has arrived.

## What to verify in code
- Is there a Records Officer role/assignment?
- Is there an annual review register driven by `review_due_date`?

## Gap (from current code)
Retention + weed-out + destruction cert + audit exist, but **no Records Officer
role and no annual review register**. Severity: **Medium** (≈60%).

## Remediation (R6)
- `estab_records_officer (id, tenant_id, operator_id, org_unit_id, appointed_at,
  active, …)` — designates the responsible officer (ties to R1 org unit).
- Query `listReviewDue(asOf)` — files whose `review_due_date <= asOf` and not yet
  reviewed/weeded, i.e. the annual review register.
- `recordAnnualReview(file_id, decision (retain|weed|archive), remarks)` stamps
  the review and reschedules the next `review_due_date` when retained.

## Test plan
- Appoint officer; `listReviewDue` returns only due, unactioned files.
- Recording a `retain` decision pushes the next review date forward.
