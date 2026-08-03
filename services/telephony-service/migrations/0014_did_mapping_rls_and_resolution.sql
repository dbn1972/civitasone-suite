-- Purpose: Repair DID mapping tenant isolation and make inbound DID -> tenant
--          resolution possible for carrier webhooks.
-- Rollback:
--   DROP FUNCTION IF EXISTS telephony.did_mappings_for_number(text);
--   DROP POLICY IF EXISTS tenant_isolation_policy ON telephony.did_mappings;
--   CREATE POLICY tenant_isolation ON telephony.did_mappings
--     USING (tenant_id = current_setting('app.tenant_id')::uuid)
--     WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
-- Affected services: telephony-service (inbound call routing, DID administration)

SET lock_timeout = '5s';

-- NULL-safe tenant GUC accessor, identical to migrations 0004/0005.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- did_mappings (added in 0010) was the only telephony table whose policy read
-- the raw GUC. With no tenant context that raises `unrecognized configuration
-- parameter "app.tenant_id"` (or `invalid input syntax for type uuid: ""` once
-- a transaction-local set_config has left the parameter defined and empty)
-- instead of simply matching zero rows, so the table failed loudly rather than
-- failing closed. Align it with every other telephony table.
ALTER TABLE telephony.did_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.did_mappings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON telephony.did_mappings;
DROP POLICY IF EXISTS tenant_isolation_policy ON telephony.did_mappings;
CREATE POLICY tenant_isolation_policy ON telephony.did_mappings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- An inbound carrier webhook is pre-tenant by definition: the dialed number is
-- what identifies the tenant, so the lookup cannot run inside a tenant scope.
-- Under FORCE RLS a tenant-scoped SELECT can never see another tenant's
-- mapping, which makes inbound routing impossible. Expose exactly that one
-- lookup through a SECURITY DEFINER function so the connecting role never gains
-- a general cross-tenant read: the caller must already know the dialed number,
-- and only active rows matching that number are returned. Number comparison is
-- normalised the same way `normalizeNumber()` does in the domain layer, so a
-- carrier that formats the number with spaces/dashes still matches.
CREATE OR REPLACE FUNCTION telephony.did_mappings_for_number(p_number text)
RETURNS TABLE (did_number varchar, tenant_id uuid, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = telephony, pg_temp
AS $$
  SELECT m.did_number, m.tenant_id, m.active
  FROM telephony.did_mappings m
  WHERE m.active
    AND coalesce(p_number, '') <> ''
    AND regexp_replace(m.did_number, '[\s()-]', '', 'g')
      = regexp_replace(p_number, '[\s()-]', '', 'g')
$$;

REVOKE ALL ON FUNCTION telephony.did_mappings_for_number(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'telephony_svc') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION telephony.did_mappings_for_number(text) TO telephony_svc';
  END IF;
END $$;
