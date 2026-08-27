-- 0002b_missing_module_tables.sql
-- role_features module is declared in Drizzle
-- (src/modules/role-features/schema.ts) but no migration ever created its
-- table. Schema role_features is created by the DB bootstrap
-- (bootstrap_missing_schemas.sql); table here, columns matching schema.ts
-- verbatim.

CREATE TABLE IF NOT EXISTS role_features.role_feature_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid         NOT NULL,
  role_name   varchar(100) NOT NULL,
  feature_key varchar(200) NOT NULL,
  granted     boolean      NOT NULL DEFAULT true,
  granted_by  uuid         NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  version     integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_role_feature_grants_tenant_id ON role_features.role_feature_grants(tenant_id);
