-- Purpose: GAP-WORKS-REPORTS-01 — add a works DIVISION master (works.divisions)
--          so the reports filter can offer a name->uuid picker instead of a
--          raw "Division UUID" text box. The reporting filter's divisionId is
--          matched against works.work_office_mappings.division_id (an opaque
--          uuid with no name source until now); this master is that source.
-- Rollback: DROP TABLE IF EXISTS works.divisions;
-- Affected services: works-service

SET lock_timeout = '5s';

-- Additive + idempotent. Mirrors the shape of the sibling masters in
-- 0001/0009 (id/tenant_id/name/code/active/version). `office_type` lets a
-- tenant distinguish division vs sub-division vs circle if it wants, but the
-- reports picker only needs name->id so it is optional.
CREATE TABLE IF NOT EXISTS works.divisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  code varchar(64) NOT NULL,
  office_type varchar(64),
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

-- Leading tenant_id index (the tenant-index-guard minimum bar), matching
-- 0009_masters_remaining_tables.sql / 0022_perf016_tenant_indexes.sql.
-- Not CONCURRENTLY: the table is brand new and empty, so a plain CREATE INDEX
-- takes no meaningful lock and keeps this file runnable inside one psql -f.
CREATE INDEX IF NOT EXISTS idx_works_divisions_tenant
  ON works.divisions (tenant_id);

-- Explicit grant for prod bootstraps that do not rely on the schema default
-- ACL (the test/dev DB already auto-grants arwd to works_svc via the works
-- schema default privilege; this GRANT is idempotent and harmless there).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'works_svc') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON works.divisions TO works_svc';
  END IF;
END $$;

-- Tenant isolation: same FORCE RLS + app.tenant_id GUC policy every other
-- works.* master carries (0010_rls_tenant_isolation.sql). Idempotent.
ALTER TABLE works.divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE works.divisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON works.divisions;
CREATE POLICY tenant_isolation_policy ON works.divisions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
