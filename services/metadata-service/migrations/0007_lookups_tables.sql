-- 0007_lookups_tables.sql
--
-- metadata.kv_store / lookup_tables / lookup_values / enum_definitions are
-- declared in Drizzle (src/modules/lookups/schema.ts) and queried by the
-- registered lookups routes (src/modules/lookups/routes.ts), but no migration
-- ever created them. Found by scripts/ci/schema-drift-guard.mjs (32 declared
-- columns with no database counterpart). Columns match schema.ts verbatim.
--
-- routes.ts upserts with ON CONFLICT on (tenant_id, ns, k) for kv_store and on
-- (tenant_id, name) for enum_definitions, so those unique indexes are required,
-- not decorative.
--
-- Additive and idempotent. Rollback:
--   DROP TABLE IF EXISTS metadata.kv_store, metadata.lookup_values,
--     metadata.lookup_tables, metadata.enum_definitions;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS metadata.kv_store (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  ns         varchar(128) NOT NULL DEFAULT 'default',
  k          varchar(512) NOT NULL,
  v          jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kv_store_tenant_ns_k ON metadata.kv_store (tenant_id, ns, k);

CREATE TABLE IF NOT EXISTS metadata.lookup_tables (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  code        varchar(128) NOT NULL,
  label       varchar(256) NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metadata_lookup_tables_tenant ON metadata.lookup_tables (tenant_id, code);

CREATE TABLE IF NOT EXISTS metadata.lookup_values (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lookup_id  uuid NOT NULL,
  tenant_id  uuid NOT NULL,
  value_code varchar(128) NOT NULL,
  label      varchar(256) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_metadata_lookup_values_tenant ON metadata.lookup_values (tenant_id, lookup_id);

CREATE TABLE IF NOT EXISTS metadata.enum_definitions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  name       varchar(128) NOT NULL,
  "values"   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_enum_definitions_tenant_name ON metadata.enum_definitions (tenant_id, name);

-- Tenant isolation: NULL-safe inline accessor, so an unset GUC matches zero rows
-- instead of raising (`invalid input syntax for type uuid: ""`).
ALTER TABLE metadata.kv_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.kv_store FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON metadata.kv_store;
CREATE POLICY tenant_isolation_policy ON metadata.kv_store
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE metadata.lookup_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.lookup_tables FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON metadata.lookup_tables;
CREATE POLICY tenant_isolation_policy ON metadata.lookup_tables
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE metadata.lookup_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.lookup_values FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON metadata.lookup_values;
CREATE POLICY tenant_isolation_policy ON metadata.lookup_values
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE metadata.enum_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.enum_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON metadata.enum_definitions;
CREATE POLICY tenant_isolation_policy ON metadata.enum_definitions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
