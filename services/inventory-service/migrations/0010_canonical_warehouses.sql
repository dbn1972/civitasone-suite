-- Purpose: Add canonical 'warehouses' table to inventory schema as part of
-- stock-service / inventory-service unification (Req 14.1). The existing
-- 'stores' table continues to serve its purpose; 'warehouses' represents the
-- higher-level physical warehouse concept that stock-service previously owned.
--
-- Rollback: DROP TABLE IF EXISTS inventory.warehouses;
--
-- Affected services: inventory-service, stock-service (proxy)

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS inventory.warehouses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  name        VARCHAR(200) NOT NULL,
  code        VARCHAR(64) NOT NULL,
  address     VARCHAR(512),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL,
  updated_by  UUID NOT NULL,
  version     INT NOT NULL DEFAULT 1
);

-- RLS enforcement
ALTER TABLE inventory.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.warehouses FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'warehouses' AND schemaname = 'inventory' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON inventory.warehouses
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;

-- Index for tenant lookups
CREATE INDEX IF NOT EXISTS idx_warehouses_tenant_id ON inventory.warehouses (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_tenant_code ON inventory.warehouses (tenant_id, code);
