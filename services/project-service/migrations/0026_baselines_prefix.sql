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
--   (the legacy 0005 table is intentionally not recreated — it was unused.)
-- Run as: project_svc (or superuser) on civitas_project
-- Affected services: project-service (scheduling/baselines + world-class EVM check)

SET lock_timeout = '5s';

DO $$
BEGIN
  -- Only act while the pre-rename state is present (idempotent).
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'project' AND table_name = 'baselines'
  ) THEN
    -- Retire the legacy, unused, differently-shaped project_baselines first so
    -- the rename target name is free. Its RLS/indexes drop with it.
    EXECUTE 'DROP TABLE IF EXISTS project.project_baselines';
    -- Rename the active table to carry the mandatory service prefix. Its RLS
    -- policy, indexes and grants travel with the table under RENAME.
    EXECUTE 'ALTER TABLE project.baselines RENAME TO project_baselines';
  END IF;
END
$$;
