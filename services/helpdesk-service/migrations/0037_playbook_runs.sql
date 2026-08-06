-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 0037: G13 — playbook runs (playbook ↔ ticket binding)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Purpose:
--   G13 — creates helpdesk.playbook_runs: one run binds one playbook version to
--   one ticket and tracks overall progress.
--
--   The UNIQUE index on (tenant_id, ticket_id) is the load-bearing part of this
--   migration. The auto-attach consumer (on helpdesk.ticket.created) can be
--   redelivered while a manual attach is in flight for the same ticket; an
--   application-level "does a run exist?" check cannot arbitrate that race
--   because both callers read before either writes. The database can, and
--   insertRunIfAbsent() relies on it via ON CONFLICT DO NOTHING.
--
-- Rollback:
--   -- Roll back 0038 first (run steps reference playbook_runs.id).
--   DROP INDEX CONCURRENTLY IF EXISTS helpdesk.idx_playbook_runs_playbook;
--   DROP INDEX CONCURRENTLY IF EXISTS helpdesk.idx_playbook_runs_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS helpdesk.uq_playbook_runs_tenant_ticket;
--   DROP TABLE IF EXISTS helpdesk.playbook_runs;
--
-- Affected services: helpdesk-service
-- Sequencing: after 0036_playbooks.sql
-- ══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS helpdesk;

CREATE TABLE IF NOT EXISTS helpdesk.playbook_runs (
  id                       uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid         NOT NULL,
  playbook_id              uuid         NOT NULL REFERENCES helpdesk.playbooks(id),
  -- Denormalised so a run renders without joining its playbook.
  playbook_key             varchar(128) NOT NULL,
  playbook_version_number  integer      NOT NULL DEFAULT 1,
  ticket_id                uuid         NOT NULL REFERENCES helpdesk.tickets(id),
  status                   varchar(16)  NOT NULL DEFAULT 'in_progress',
  -- Whole percent of steps completed; recomputed on every step completion.
  progress_pct             integer      NOT NULL DEFAULT 0,
  started_at               timestamptz  NOT NULL DEFAULT now(),
  completed_at             timestamptz,
  -- True when attached automatically at ticket creation (vs. by an agent).
  auto_attached            boolean      NOT NULL DEFAULT false,
  created_at               timestamptz  NOT NULL DEFAULT now(),
  updated_at               timestamptz  NOT NULL DEFAULT now(),
  created_by               uuid         NOT NULL,
  updated_by               uuid         NOT NULL,
  version                  integer      NOT NULL DEFAULT 1
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'helpdesk' AND t.relname = 'playbook_runs'
      AND c.conname = 'chk_playbook_runs_status'
  ) THEN
    ALTER TABLE helpdesk.playbook_runs
      ADD CONSTRAINT chk_playbook_runs_status
      CHECK (status IN ('in_progress', 'completed', 'abandoned'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'helpdesk' AND t.relname = 'playbook_runs'
      AND c.conname = 'chk_playbook_runs_progress'
  ) THEN
    ALTER TABLE helpdesk.playbook_runs
      ADD CONSTRAINT chk_playbook_runs_progress
      CHECK (progress_pct BETWEEN 0 AND 100);
  END IF;
END$$;

-- ── IDEMPOTENCY GUARD: at most one run per ticket, enforced by the database ──
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_playbook_runs_tenant_ticket
  ON helpdesk.playbook_runs (tenant_id, ticket_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_playbook_runs_tenant_status
  ON helpdesk.playbook_runs (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_playbook_runs_playbook
  ON helpdesk.playbook_runs (playbook_id);

-- ─── RLS ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'helpdesk' AND c.relname = 'playbook_runs' AND c.relrowsecurity
  ) THEN
    ALTER TABLE helpdesk.playbook_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE helpdesk.playbook_runs FORCE ROW LEVEL SECURITY;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'helpdesk' AND tablename = 'playbook_runs'
      AND policyname = 'tenant_isolation_playbook_runs'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation_playbook_runs ON helpdesk.playbook_runs
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    $pol$;
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpdesk_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON helpdesk.playbook_runs TO helpdesk_svc;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpdesk_scanner') THEN
    GRANT SELECT ON helpdesk.playbook_runs TO helpdesk_scanner;
  END IF;
END$$;
