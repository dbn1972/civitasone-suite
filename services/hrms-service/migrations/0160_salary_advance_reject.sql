-- 0160_salary_advance_reject.sql
--
-- GAP-HR-ADVANCES-02: an advance could never leave "Pending" via a reject
-- path -- no reject endpoint existed, and hrms_salary_advances had no
-- columns to record who rejected a request or why. Additive, idempotent:
-- both columns are nullable and only ever populated by the new
-- PATCH /v1/hrms/salary-advances/:id/reject route (loans-routes.ts) via its
-- consumer (loans-consumer.ts, COMMANDS.salaryAdvanceReject). The `status`
-- column itself is an unconstrained varchar(16) (see 0014's own comment:
-- "pending|approved|active|completed|rejected") -- 'rejected' was already an
-- anticipated value with no CHECK constraint change required.

ALTER TABLE employee.hrms_salary_advances
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejection_reason varchar(500);
