-- 0045_fnf_settlements_unique_with_date.sql
-- CRITICAL fix (PR #1552 review, live-reproduced against real Postgres):
-- 0044_fnf_settlements_unique.sql's unique index on (tenant_id, employee_id)
-- has no date dimension, but an employee CAN be legitimately separated more
-- than once (separate -> reinstate -> separate again) -- see
-- hrms-service/src/modules/employee/commands.ts's separateEmployee(), whose
-- messageId is deliberately keyed on `employeeId:effectiveDate` for exactly
-- this reason (a re-separation on a different effective/separation date must
-- publish and process independently of any earlier separation).
--
-- The 0044 index did not honour that: a second, entirely legitimate
-- settlement for the same employee but a DIFFERENT separation_date hit
-- payroll.fnf_settlements' ON CONFLICT (tenant_id, employee_id) DO NOTHING
-- (fnf/consumer.ts) and was silently dropped -- zero rows written, zero
-- error, zero log. Live-reproduced: settlement #1 (e.g. resignation,
-- 2025-01-01) inserts; settlement #2 (e.g. retirement, 2025-06-30) for the
-- SAME employee vanishes outright. Worse than the original gap (a rare
-- double-submit race) -- this was a guaranteed silent data loss for a
-- legitimate, documented workflow.
--
-- Fix: widen the unique key to (tenant_id, employee_id, separation_date).
-- separation_date (0022_fnf_ltc_exemptions.sql) is NOT NULL on this table, so
-- every existing row qualifies. Widening a unique index only ever makes it
-- LESS restrictive -- every row that satisfied the old 2-column key still
-- satisfies this 3-column one, so no pre-existing row can newly violate it
-- and no further dedup pass is needed here (0044 already deduped down to one
-- row per tenant+employee; that is a strict subset of "one row per
-- tenant+employee+separation_date").
--
-- Not editing 0044 directly: it may already be applied elsewhere (this
-- repo's migrations are forward-only -- see e.g. 0143_apar_scores_audit_columns.sql
-- / 0143_service_book_audit_columns.sql and the various *_followup.sql /
-- *_fix.sql migrations throughout this fleet for the same "correct with a
-- new migration, never rewrite an already-numbered one" convention).
DROP INDEX IF EXISTS payroll.fnf_settlements_tenant_employee_uq;

CREATE UNIQUE INDEX IF NOT EXISTS fnf_settlements_tenant_employee_date_uq
  ON payroll.fnf_settlements (tenant_id, employee_id, separation_date);
