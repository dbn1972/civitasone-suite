-- Migration 0026: GAP2-PROJECTS-DB-BASELINES-PREFIX-01 — one-service-one-prefix
-- for the baseline table (CLAUDE.md §3.2: every table in a service starts with
-- `{service}_`).
--
-- project-service had TWO overlapping baseline tables:
--   * project.baselines           (0017) — the LIVE/active table used by
--     scheduling/baselines.ts + its commands/consumer and the EVM
--     baseline-required check (world-class-routes). Shape: label/snapshot_data.
--     Its name violates the prefix rule (no `project_`).
--   * project.project_baselines   (0005) — an OLDER, differently-shaped table
--     (baseline_no/planned_*) read ONLY as a backward-compat fallback by the EVM
--     baseline-required check. No code writes it.
--
-- This consolidates to ONE prefixed table: drop the legacy project_baselines,
-- then rename the active project.baselines → project.project_baselines so the
-- live table carries the mandatory prefix. Expand/contract-safe and idempotent
-- (guards on information_schema so a re-run is a no-op once applied).
--
-- Rollback:
--   ALTER TABLE project.project_baselines RENAME TO baselines;
--   (the legacy 0005 table is intentionally not recreated; the migration refuses
--   to run while it still holds rows, so only an empty table is ever dropped.)
-- Run as: project_svc (or superuser) on civitas_project
-- Affected services: project-service (scheduling/baselines + world-class EVM check)

SET lock_timeout = '5s';

DO $$
DECLARE
  legacy_has_rows boolean := false;
BEGIN
  -- Only act while the pre-rename state is present (idempotent).
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'project' AND table_name = 'baselines'
  ) THEN
    -- Retire the legacy, differently-shaped project_baselines first so the
    -- rename target name is free. Never drop data silently: the table is FORCE
    -- RLS, so lift FORCE just long enough to see every row, and abort the whole
    -- migration (nothing is dropped or renamed) if any row exists.
    IF to_regclass('project.project_baselines') IS NOT NULL THEN
      EXECUTE 'ALTER TABLE project.project_baselines NO FORCE ROW LEVEL SECURITY';
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM project.project_baselines)' INTO legacy_has_rows;
      EXECUTE 'ALTER TABLE project.project_baselines FORCE ROW LEVEL SECURITY';
      IF legacy_has_rows THEN
        RAISE EXCEPTION 'migration 0026 aborted: legacy project.project_baselines (0005) is not empty; migrate or archive its rows to project.baselines before re-running';
      END IF;
      EXECUTE 'DROP TABLE project.project_baselines';
    END IF;
    -- Rename the active table to carry the mandatory service prefix. Its RLS
    -- policy, indexes and grants travel with the table under RENAME.
    EXECUTE 'ALTER TABLE project.baselines RENAME TO project_baselines';
  END IF;
END
$$;
