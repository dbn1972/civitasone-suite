-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 0038: G13 — per-step completion for playbook runs
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Purpose:
--   G13 — creates helpdesk.playbook_run_steps: who completed which guided step
--   of a run, and when.
--
--   WHY A TABLE HERE, WHEN THE STEP DEFINITIONS ARE JSONB (0036): definitions
--   are read as a whole immutable unit; completions are written one row at a
--   time, by different actors, at different times, and each one must be
--   individually auditable. Storing them back into the playbook's JSONB would
--   mean a read-modify-write of a shared document on every step an agent ticks
--   off — lost updates under concurrency, and no per-row audit.
--
--   Rows are inserted up-front at run start (one per step in the playbook
--   version), snapshotting ordinal/type/title/mandatory/sla_offset. That is
--   deliberate: the "can this run be completed?" check then reads only this
--   table, and the record of work done stays intact even if the playbook is
--   later deprecated.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS helpdesk.idx_playbook_run_steps_outstanding;
--   DROP INDEX CONCURRENTLY IF EXISTS helpdesk.uq_playbook_run_steps_run_step;
--   DROP TABLE IF EXISTS helpdesk.playbook_run_steps;
--
-- Affected services: helpdesk-service
-- Sequencing: after 0037_playbook_runs.sql
-- ══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS helpdesk;

CREATE TABLE IF NOT EXISTS helpdesk.playbook_run_steps (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid         NOT NULL,
  run_id               uuid         NOT NULL REFERENCES helpdesk.playbook_runs(id) ON DELETE CASCADE,
  -- PlaybookStep.id within the run's playbook version.
  step_id              varchar(64)  NOT NULL,
  ordinal              integer      NOT NULL,
  step_type            varchar(24)  NOT NULL,
  title                varchar(200) NOT NULL,
  mandatory            boolean      NOT NULL DEFAULT false,
  sla_offset_minutes   integer,
  knowledge_article_id uuid,
  completed_at         timestamptz,
  completed_by         uuid,
  note                 text,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'helpdesk' AND t.relname = 'playbook_run_steps'
      AND c.conname = 'chk_playbook_run_steps_type'
  ) THEN
    ALTER TABLE helpdesk.playbook_run_steps
      ADD CONSTRAINT chk_playbook_run_steps_type
      CHECK (step_type IN ('instruction', 'task', 'knowledge_link', 'form', 'escalate'));
  END IF;
END$$;

-- A completion must record WHO did it: completed_at and completed_by are set
-- together or not at all.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'helpdesk' AND t.relname = 'playbook_run_steps'
      AND c.conname = 'chk_playbook_run_steps_completion'
  ) THEN
    ALTER TABLE helpdesk.playbook_run_steps
      ADD CONSTRAINT chk_playbook_run_steps_completion
      CHECK ((completed_at IS NULL) = (completed_by IS NULL));
  END IF;
END$$;

-- One completion row per (tenant, run, step).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_playbook_run_steps_run_step
  ON helpdesk.playbook_run_steps (tenant_id, run_id, step_id);

-- "Which mandatory steps are still outstanding for this run?" — the query
-- behind the 422 on run completion.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_playbook_run_steps_outstanding
  ON helpdesk.playbook_run_steps (tenant_id, run_id)
  WHERE completed_at IS NULL AND mandatory = true;

-- ─── RLS ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'helpdesk' AND c.relname = 'playbook_run_steps' AND c.relrowsecurity
  ) THEN
    ALTER TABLE helpdesk.playbook_run_steps ENABLE ROW LEVEL SECURITY;
    ALTER TABLE helpdesk.playbook_run_steps FORCE ROW LEVEL SECURITY;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'helpdesk' AND tablename = 'playbook_run_steps'
      AND policyname = 'tenant_isolation_playbook_run_steps'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation_playbook_run_steps ON helpdesk.playbook_run_steps
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    $pol$;
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpdesk_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON helpdesk.playbook_run_steps TO helpdesk_svc;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpdesk_scanner') THEN
    GRANT SELECT ON helpdesk.playbook_run_steps TO helpdesk_scanner;
  END IF;
END$$;
