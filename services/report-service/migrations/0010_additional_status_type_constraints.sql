-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: report-service

SET lock_timeout = '5s';

-- ============================================================================
-- reports.jobs.report_type
-- SKIPPED: unbounded/free-form. This is a client-supplied label (varchar(64),
-- nullable, no default) with no zod enum in modules/jobs/schema.ts's
-- createJobBody (plain z.string().min(1).max(64).optional()) and no domain
-- state machine. commands.ts/consumer.ts simply pass the value through.
-- routes.ts only falls back to the literal "general" when reportType is null
-- (a display default, not a validated enum member) and a test uses an
-- arbitrary "custom" value. The prior status-column migration
-- (0008_check_constraints_status_columns.sql) deliberately constrained only
-- reports.jobs.status and reports.kpis.status, leaving report_type open —
-- confirming this is intentionally free-form. Do not guess a closed set.
-- ============================================================================

-- No new constraints to add in this migration — report_type is genuinely
-- unbounded/free-form (see rationale above).
