-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: project-service

SET lock_timeout = '5s';

-- ============================================================================
-- scheme.project_schemes.type
-- SKIPPED: already has an enforced CHECK constraint, added inline in
-- 0001_init.sql — CHECK (type IN ('css','state','central')). Postgres
-- auto-named that unnamed column CHECK "project_schemes_type_check" (the
-- default {table}_{column}_check naming). Verified against every literal
-- assignment in modules/scheme/validators.ts, consumer.ts, and queries.ts —
-- all three values (css, state, central) match the existing constraint.
-- No further action is needed here.
-- ============================================================================

-- No new constraints to add in this migration — the only column assigned to
-- project-service in this pass (scheme.project_schemes.type) is already covered.
