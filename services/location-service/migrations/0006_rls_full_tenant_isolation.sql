-- RLS completion: full tenant isolation (USING + WITH CHECK) for location-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- geofence.geofences
ALTER TABLE geofence.geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE geofence.geofences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON geofence.geofences;
DROP POLICY IF EXISTS tenant_isolation ON geofence.geofences;
CREATE POLICY tenant_isolation_policy ON geofence.geofences
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- hierarchy.administrative_units
ALTER TABLE hierarchy.administrative_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE hierarchy.administrative_units FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hierarchy.administrative_units;
DROP POLICY IF EXISTS tenant_isolation ON hierarchy.administrative_units;
CREATE POLICY tenant_isolation_policy ON hierarchy.administrative_units
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- jurisdiction.jurisdictions
ALTER TABLE jurisdiction.jurisdictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE jurisdiction.jurisdictions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON jurisdiction.jurisdictions;
DROP POLICY IF EXISTS tenant_isolation ON jurisdiction.jurisdictions;
CREATE POLICY tenant_isolation_policy ON jurisdiction.jurisdictions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- location.locations
ALTER TABLE location.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE location.locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON location.locations;
DROP POLICY IF EXISTS tenant_isolation ON location.locations;
CREATE POLICY tenant_isolation_policy ON location.locations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id())';
  END IF;
END $$;
