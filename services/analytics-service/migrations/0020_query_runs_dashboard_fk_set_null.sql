-- Purpose: UAT FQ12 #54. DELETE /v1/analytics/dashboards/:id returned 202 but the
--          dashboard was never removed: analytics.query_runs.dashboard_id references
--          analytics.dashboards(id) with the default NO ACTION (0001_init.sql), so the
--          consumer's DELETE failed with query_runs_dashboard_id_fkey for any dashboard
--          that had ever run a query, and the command dead-lettered.
--          query_runs is run HISTORY (dashboard_id is nullable, ad-hoc runs have none),
--          so the history is kept and detached from the deleted dashboard:
--          ON DELETE SET NULL. Widgets/shares already CASCADE (0002_hardening.sql).
-- Idempotent: re-creates the FK only when it is missing or not already SET NULL.
-- Rollback: ALTER TABLE analytics.query_runs DROP CONSTRAINT IF EXISTS query_runs_dashboard_id_fkey;
--           ALTER TABLE analytics.query_runs ADD CONSTRAINT query_runs_dashboard_id_fkey
--             FOREIGN KEY (dashboard_id) REFERENCES analytics.dashboards(id);
-- Affected services: analytics-service

SET lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'analytics.query_runs'::regclass
      AND conname = 'query_runs_dashboard_id_fkey'
      AND contype = 'f'
      AND confdeltype = 'n'   -- 'n' = SET NULL
  ) THEN
    ALTER TABLE analytics.query_runs DROP CONSTRAINT IF EXISTS query_runs_dashboard_id_fkey;
    -- NOT VALID + VALIDATE: existing rows already satisfy the FK; avoids a long
    -- ACCESS EXCLUSIVE scan while the constraint is re-added.
    ALTER TABLE analytics.query_runs
      ADD CONSTRAINT query_runs_dashboard_id_fkey
      FOREIGN KEY (dashboard_id) REFERENCES analytics.dashboards(id) ON DELETE SET NULL
      NOT VALID;
    ALTER TABLE analytics.query_runs VALIDATE CONSTRAINT query_runs_dashboard_id_fkey;
  END IF;
END $$;
