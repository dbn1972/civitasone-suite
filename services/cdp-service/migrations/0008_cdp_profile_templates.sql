-- Purpose: CR-CDP-01 — per-tenant, per-vertical golden profile templates. `attributes_spec`
--          declares which attributes a golden profile of that vertical carries;
--          `conflict_rules` declares which source wins per attribute when two sources
--          disagree (most_recent / highest_source_priority / first_non_null), with
--          `default_strategy` + `source_priority` as the fallback policy.
-- Rollback: DROP TABLE IF EXISTS cdp.profile_templates;  (destructive — requires approval)
--           Rolling back loses tenant survivorship configuration but no customer data:
--           golden profiles already written are unaffected.
-- Affected services: cdp-service (owner). No other service reads this table; template
--           application is exposed over HTTP (POST /v1/cdp/profiles/{id}/apply-template).
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS cdp.profile_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  vertical         varchar(64) NOT NULL,
  profile_type     varchar(32) NOT NULL DEFAULT 'individual',
  label            varchar(160) NOT NULL,
  attributes_spec  jsonb NOT NULL DEFAULT '[]'::jsonb,
  conflict_rules   jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_strategy varchar(32) NOT NULL DEFAULT 'most_recent'
                   CONSTRAINT profile_templates_strategy_chk
                   CHECK (default_strategy IN ('most_recent', 'highest_source_priority', 'first_non_null')),
  source_priority  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          int NOT NULL DEFAULT 1
);

-- One template per (tenant, vertical, profile type): the uniqueness the API's 409 defends.
-- A unique INDEX rather than a table constraint, because ADD CONSTRAINT is not idempotent.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_profile_templates_vertical
  ON cdp.profile_templates (tenant_id, vertical, profile_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profile_templates_tenant
  ON cdp.profile_templates (tenant_id, vertical);

ALTER TABLE cdp.profile_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdp.profile_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_templates_tenant_isolation ON cdp.profile_templates;
CREATE POLICY profile_templates_tenant_isolation ON cdp.profile_templates
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cdp_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON cdp.profile_templates TO cdp_svc;
  END IF;
END $g$;
