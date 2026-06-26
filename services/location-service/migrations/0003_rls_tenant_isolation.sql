-- Additive, idempotent. Safe to re-run.
-- Enables Row Level Security on all domain tables that carry tenant_id.
-- location.locations stores per-tenant location data (not national master data);
-- the table has tenant_id, confirming tenant scoping.
-- _outbox and _inbox are infra relay schemas consumed by a BYPASSRLS service role;
-- they are intentionally excluded from RLS.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- location.locations
ALTER TABLE location.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE location.locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON location.locations;
CREATE POLICY tenant_isolation ON location.locations
  USING (tenant_id = current_tenant_id());
