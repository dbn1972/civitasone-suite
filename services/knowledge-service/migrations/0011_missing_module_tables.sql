-- 0011_missing_module_tables.sql
--
-- Purpose: create the five knowledge-service tables that Drizzle models declare
-- but no migration ever created:
--   knowledge.categories          (13 columns)
--   knowledge.document_versions   (12)
--   knowledge.document_shares     (11)
--   knowledge.retention_policies  (14)
--   knowledge.search_index         (8)
--
-- DEFECT THIS FIXES (P0, live)
-- Every request to those modules was a 500 against the running fleet, and the
-- error was returned to the client verbatim:
--
--   GET http://localhost:3028/v1/knowledge/categories
--   -> 500 {"statusCode":500,"code":"42P01",
--           "message":"relation \"knowledge.categories\" does not exist"}
--
-- Found by scripts/ci/schema-drift-guard.mjs (58 columns reported missing).
--
-- HOW THIS SURVIVED
-- 0004_rls_full_tenant_isolation.sql already names all five tables in ALTER TABLE
-- statements, so the omission was not merely unnoticed — a migration was actively
-- depending on tables that did not exist. It went unseen because
-- scripts/ci/bootstrap-postgres.sh logs a warning and CONTINUES when a migration
-- fails, so the bootstrap still exits 0. (0004 in fact aborts even earlier, at
-- `CREATE OR REPLACE FUNCTION current_tenant_id` — "must be owner of function"
-- when run as knowledge_svc.) That swallowing is tracked separately as a P0
-- finding; it is the reason 338 drifts accumulated fleet-wide without CI noticing.
--
-- Types taken directly from the models, not inferred:
--   bigint(mode:"number")            -> bigint       (size_bytes; byte count, not money)
--   varchar(s3_key,{length:1024})    -> varchar(1024)
--   text("tags").array().default([]) -> text[] NOT NULL DEFAULT '{}'
--   timestamp({withTimezone:true})   -> timestamptz
-- `notifyBefore` maps to column `notify_before_days` — the property and column
-- names differ in the model, and the column name is what the database needs.
--
-- CHECK constraints are added only where the allowed values are established by
-- code: permission ∈ (view, edit) from sharing/validators.ts:6 and action ∈
-- (archive, destroy) from retention/validators.ts:8. `search_index.status` gets
-- NO constraint: nothing in the service ever writes it explicitly, so the only
-- observed value is the model default. Inventing a domain for it would risk
-- rejecting a legitimate future write.
--
-- Rollback:
--   DROP TABLE IF EXISTS knowledge.search_index;
--   DROP TABLE IF EXISTS knowledge.retention_policies;
--   DROP TABLE IF EXISTS knowledge.document_shares;
--   DROP TABLE IF EXISTS knowledge.document_versions;
--   DROP TABLE IF EXISTS knowledge.categories;
--   (Safe: all five are new and hold no data prior to this migration.)
--
-- Affected services: knowledge-service (categories, versions, sharing,
-- retention, search modules)
-- Additive and idempotent.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS knowledge.categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  parent_id   uuid,
  name        text        NOT NULL,
  slug        text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  icon        varchar(64),
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        NOT NULL,
  updated_by  uuid        NOT NULL,
  version     integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS knowledge.document_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid          NOT NULL,
  document_id uuid          NOT NULL,
  version_no  integer       NOT NULL,
  s3_key      varchar(1024) NOT NULL,
  size_bytes  bigint,
  change_note text          NOT NULL DEFAULT '',
  created_by  uuid          NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  updated_by  uuid          NOT NULL,
  version     integer       NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS knowledge.document_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  document_id uuid        NOT NULL,
  shared_with uuid        NOT NULL,
  permission  varchar(24) NOT NULL DEFAULT 'view',
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        NOT NULL,
  updated_by  uuid        NOT NULL,
  version     integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS knowledge.retention_policies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid         NOT NULL,
  name                varchar(200) NOT NULL,
  category_id         uuid,
  retention_years     integer      NOT NULL,
  retention_days      integer      NOT NULL DEFAULT 0,
  action              varchar(24)  NOT NULL DEFAULT 'archive',
  notify_before_days  integer      NOT NULL DEFAULT 90,
  reminder_months     integer      NOT NULL DEFAULT 3,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  created_by          uuid         NOT NULL,
  updated_by          uuid         NOT NULL,
  version             integer      NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS knowledge.search_index (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  document_id uuid        NOT NULL,
  title       text        NOT NULL,
  content     text        NOT NULL DEFAULT '',
  tags        text[]      NOT NULL DEFAULT '{}',
  status      varchar(24) NOT NULL DEFAULT 'indexed',
  indexed_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'document_shares_permission_check'
                    AND conrelid = 'knowledge.document_shares'::regclass) THEN
    ALTER TABLE knowledge.document_shares
      ADD CONSTRAINT document_shares_permission_check
      CHECK (permission IN ('view', 'edit'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'retention_policies_action_check'
                    AND conrelid = 'knowledge.retention_policies'::regclass) THEN
    ALTER TABLE knowledge.retention_policies
      ADD CONSTRAINT retention_policies_action_check
      CHECK (action IN ('archive', 'destroy'));
  END IF;

  -- search_index.status: 0005_check_constraints_status_columns.sql already
  -- defines this domain as ('indexed') and names the constraint
  -- search_index_status_check. Created here under the SAME NAME so that 0005
  -- becomes a no-op (its DO block traps duplicate_object) rather than creating a
  -- second, divergent constraint.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'search_index_status_check'
                    AND conrelid = 'knowledge.search_index'::regclass) THEN
    ALTER TABLE knowledge.search_index
      ADD CONSTRAINT search_index_status_check
      CHECK (status IN ('indexed'));
  END IF;
END
$$;

-- Business keys as database-level UNIQUE constraints, per the platform rule that
-- these must not be application checks alone.
CREATE UNIQUE INDEX IF NOT EXISTS categories_tenant_slug_uk
  ON knowledge.categories (tenant_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS document_versions_doc_version_uk
  ON knowledge.document_versions (tenant_id, document_id, version_no);
CREATE UNIQUE INDEX IF NOT EXISTS document_shares_doc_principal_uk
  ON knowledge.document_shares (tenant_id, document_id, shared_with);
CREATE UNIQUE INDEX IF NOT EXISTS search_index_document_uk
  ON knowledge.search_index (tenant_id, document_id);

-- The five indexes 0007_fk_indexes.sql intended to create, under the EXACT names
-- it uses (idx_*). 0007 could not create them because the tables did not exist;
-- matching its names means 0007 becomes a no-op via IF NOT EXISTS rather than
-- creating a duplicate index under a different name.
-- Not CONCURRENTLY: these tables are brand new and empty in the same migration,
-- so there is nothing to lock. The >1K-row rule does not apply.
CREATE INDEX IF NOT EXISTS idx_categories_parent_id            ON knowledge.categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_retention_policies_category_id  ON knowledge.retention_policies (category_id);
CREATE INDEX IF NOT EXISTS idx_search_index_document_id        ON knowledge.search_index (document_id);
CREATE INDEX IF NOT EXISTS idx_document_shares_document_id     ON knowledge.document_shares (document_id);
CREATE INDEX IF NOT EXISTS idx_document_versions_document_id   ON knowledge.document_versions (document_id);

-- Tenant-scoped lookup indexes for the filters the repos actually issue.
CREATE INDEX IF NOT EXISTS categories_tenant_idx           ON knowledge.categories (tenant_id);
CREATE INDEX IF NOT EXISTS document_versions_tenant_idx    ON knowledge.document_versions (tenant_id);
CREATE INDEX IF NOT EXISTS document_versions_document_idx  ON knowledge.document_versions (tenant_id, document_id);
CREATE INDEX IF NOT EXISTS document_shares_tenant_idx      ON knowledge.document_shares (tenant_id);
CREATE INDEX IF NOT EXISTS document_shares_principal_idx   ON knowledge.document_shares (tenant_id, shared_with);
CREATE INDEX IF NOT EXISTS retention_policies_tenant_idx   ON knowledge.retention_policies (tenant_id);
CREATE INDEX IF NOT EXISTS retention_policies_category_idx ON knowledge.retention_policies (tenant_id, category_id);
CREATE INDEX IF NOT EXISTS search_index_tenant_idx         ON knowledge.search_index (tenant_id);

-- Tenant isolation. 0004 intended to do this and could not, because the tables
-- did not exist. Applied here with USING + WITH CHECK so a write cannot place a
-- row in another tenant, not merely fail to read one.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories','document_versions','document_shares','retention_policies','search_index']
  LOOP
    EXECUTE format('ALTER TABLE knowledge.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE knowledge.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON knowledge.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON knowledge.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_policy ON knowledge.%I '
      'USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END
$$;

COMMENT ON TABLE knowledge.categories IS 'Hierarchical document taxonomy (parent_id self-reference).';
COMMENT ON TABLE knowledge.document_versions IS 'Immutable version history; payload in object storage under s3_key.';
COMMENT ON TABLE knowledge.document_shares IS 'Per-principal document grants with optional expiry.';
COMMENT ON TABLE knowledge.retention_policies IS 'DPDP retention schedule per category; action archive|destroy.';
COMMENT ON TABLE knowledge.search_index IS 'Denormalised search projection, one row per document.';
