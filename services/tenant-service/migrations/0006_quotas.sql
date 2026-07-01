-- Phase 1 hyperscale: per-tenant configurable quotas.
-- Lives in the `tenant` schema (owned by tenant-service).

CREATE TABLE IF NOT EXISTS tenant.tenant_quotas (
  tenant_id       UUID PRIMARY KEY,
  max_employees   INT NOT NULL DEFAULT 500,
  max_files       INT NOT NULL DEFAULT 10000,
  max_api_calls_per_min INT NOT NULL DEFAULT 200,
  max_storage_gb  INT NOT NULL DEFAULT 10,
  max_users       INT NOT NULL DEFAULT 100,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
