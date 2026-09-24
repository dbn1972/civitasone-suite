-- 0044_fnf_settlements_unique.sql
-- HIGH fix (cross-module integration audit follow-up): separateEmployee()
-- (hrms-service) used to publish hrms.employee.separate with no explicit
-- messageId, so a retried/double-clicked separation could republish
-- hrms.employee.separated twice, and payroll-service's integration/
-- consumer.ts reacts to that by publishing payroll.fnf.compute -- which
-- fnf/consumer.ts inserted with a fresh randomUUID() id and no guard,
-- risking two F&F settlement rows for one exit. The messageId fix on the
-- publish side (employee/commands.ts's separateEmployee, hrms-service) closes
-- the main path, but POST /v1/payroll/fnf/compute (fnf/routes.ts) is a
-- second, independent entry point with its own fresh randomUUID() messageId
-- and no dedup of its own -- a double-clicked "Compute F&F" hits this same
-- table from a path the hrms-side fix cannot reach. This is the defense-in-
-- depth backstop: a DB-level guarantee that holds no matter which path (or
-- future path) tries to create a second settlement for the same employee.
--
-- Dedupe any pre-existing duplicate rows first (keep the most recently
-- created one per tenant+employee) so this migration is safe to apply even
-- if a duplicate already slipped through before this fix -- expected to be a
-- no-op outside a dev/test DB that hit the bug this closes.
DELETE FROM payroll.fnf_settlements a
USING payroll.fnf_settlements b
WHERE a.tenant_id = b.tenant_id
  AND a.employee_id = b.employee_id
  AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id));

CREATE UNIQUE INDEX IF NOT EXISTS fnf_settlements_tenant_employee_uq
  ON payroll.fnf_settlements (tenant_id, employee_id);
