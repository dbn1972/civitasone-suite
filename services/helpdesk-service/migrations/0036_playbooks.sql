-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 0036: G13 — resolution playbooks (definition table)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Purpose:
--   G13 — "SLA-driven resolution with product-specific playbooks". Creates
--   helpdesk.playbooks: a VERSIONED-BY-ROW definition of an ordered set of
--   guided resolution steps, plus the four nullable matching criteria used to
--   resolve the best playbook for a ticket (NULL = matches anything).
--
--   Steps live in a `steps` JSONB array rather than a child table, matching how
--   this service already stores ordered configuration arrays
--   (catalogue_offerings.fulfilment_stages / .request_form_schema in 0014,
--   saved_views.columns in 0031). Steps are always read with their parent, are
--   never queried across playbooks, and are frozen once the version is
--   published. Per-step COMPLETION is a real table — see 0038.
--
--   Versioning is by ROW: publishing never rewrites a published row, because
--   live runs (0037) reference a version's step ids. A new editorial version is
--   a new row with the same playbook_key and a higher version_number.
--
-- Rollback:
--   -- No data loss risk for other features: this table is new and standalone.
--   DROP INDEX CONCURRENTLY IF EXISTS helpdesk.idx_playbooks_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS helpdesk.idx_playbooks_tenant_resolve;
--   DROP INDEX CONCURRENTLY IF EXISTS helpdesk.uq_playbooks_tenant_key_version;
--   DROP TABLE IF EXISTS helpdesk.playbooks;
--   -- Rolling back 0036 requires rolling back 0038 then 0037 FIRST (runs
--   -- reference playbooks.id).
--
-- Affected services: helpdesk-service
-- Sequencing: after 0035_cs001_case_creation.sql / 0035_ticket_knowledge_links.sql
-- ══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS helpdesk;

CREATE TABLE IF NOT EXISTS helpdesk.playbooks (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid         NOT NULL,
  -- Stable business key shared by every editorial version of the playbook.
  playbook_key   varchar(128) NOT NULL,
  name           varchar(200) NOT NULL,
  description    text,
  version_number integer      NOT NULL DEFAULT 1,
  status         varchar(16)  NOT NULL DEFAULT 'draft',
  published_at   timestamptz,
  -- ── matching criteria: NULL means "matches anything" ──
  category_id    uuid,
  product_code   varchar(64),
  ticket_type    varchar(24),
  priority       varchar(24),
  -- ── ordered guided steps (see rationale in the header) ──
  steps          jsonb        NOT NULL DEFAULT '[]'::jsonb,
  -- ── standard entity columns ──
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  created_by     uuid         NOT NULL,
  updated_by     uuid         NOT NULL,
  -- Optimistic-locking counter, distinct from version_number (editorial).
  version        integer      NOT NULL DEFAULT 1
);

-- Lifecycle status domain (guarded so a rerun is a no-op).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'helpdesk' AND t.relname = 'playbooks'
      AND c.conname = 'chk_playbooks_status'
  ) THEN
    ALTER TABLE helpdesk.playbooks
      ADD CONSTRAINT chk_playbooks_status
      CHECK (status IN ('draft', 'published', 'deprecated'));
  END IF;
END$$;

-- A published playbook must carry its publication timestamp: resolution breaks
-- ties by "most recently published", and a NULL there would make the ordering
-- depend on the fallback branch instead of the data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'helpdesk' AND t.relname = 'playbooks'
      AND c.conname = 'chk_playbooks_published_at'
  ) THEN
    ALTER TABLE helpdesk.playbooks
      ADD CONSTRAINT chk_playbooks_published_at
      CHECK (status <> 'published' OR published_at IS NOT NULL);
  END IF;
END$$;

-- One row per (tenant, playbook key, editorial version).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_playbooks_tenant_key_version
  ON helpdesk.playbooks (tenant_id, playbook_key, version_number);

-- Admin list view (filter by status).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_playbooks_tenant_status
  ON helpdesk.playbooks (tenant_id, status);

-- Resolution candidate scan: only published rows are ever resolved.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_playbooks_tenant_resolve
  ON helpdesk.playbooks (tenant_id, published_at DESC)
  WHERE status = 'published';

-- ─── RLS ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'helpdesk' AND c.relname = 'playbooks' AND c.relrowsecurity
  ) THEN
    ALTER TABLE helpdesk.playbooks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE helpdesk.playbooks FORCE ROW LEVEL SECURITY;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'helpdesk' AND tablename = 'playbooks'
      AND policyname = 'tenant_isolation_playbooks'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation_playbooks ON helpdesk.playbooks
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    $pol$;
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpdesk_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON helpdesk.playbooks TO helpdesk_svc;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpdesk_scanner') THEN
    GRANT SELECT ON helpdesk.playbooks TO helpdesk_scanner;
  END IF;
END$$;
