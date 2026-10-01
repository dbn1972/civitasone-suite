-- 0165_expense_claims_reject.sql
--
-- GAP-HR-EXPENSES-02: an expense claim could never leave "Pending" via a
-- reject path -- no reject endpoint existed, and claims.hrms_expense_claims
-- had no column to record why a claim was rejected (unlike its sibling
-- claims.hrms_travel_requests, which already carries `rejection_reason` from
-- migration 0115_social_feed.sql). Additive, idempotent, nullable column:
-- only ever populated by the new PATCH /v1/hrms/expenses/:id/reject route
-- (social/routes.ts). Reuses the existing approved_by/approved_at columns to
-- also record who rejected a claim and when (status='rejected' distinguishes
-- the two outcomes) -- the same convention claims.hrms_travel_requests' own
-- reject handler already uses in this same file, rather than
-- employee.hrms_salary_advances' separate rejected_by/rejected_at columns
-- (a different module, migration 0160_salary_advance_reject.sql).

ALTER TABLE claims.hrms_expense_claims
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
