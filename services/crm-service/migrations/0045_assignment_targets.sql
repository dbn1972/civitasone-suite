-- Purpose: Assignment target catalogues (AS-002) — named queues, territories,
--          partners and branches that assignment rules can reference and that the
--          admin UI manages. Ownership transfer + its history already exist
--          (crm.contact.transfer → ownership_transferred event + audit); this
--          migration only adds the target catalogues. The unified assignment
--          history lives in crm.lead_assignment_log (migration 0044), into which
--          the transfer consumer now also writes a method='transfer' row.
-- Rollback: DROP TABLE IF EXISTS crm.branches, crm.partners, crm.territories, crm.assignment_queues;
-- Affected services: crm-service
-- Sequencing: additive — independent catalogue tables, safe to apply anytime.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.assignment_queues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  team_id uuid,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS crm.territories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  code varchar(64) NOT NULL,
  region varchar(64),
  owner_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS crm.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  partner_type varchar(64),
  owner_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS crm.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  code varchar(64),
  territory_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assignment_queues_tenant ON crm.assignment_queues(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_territories_tenant ON crm.territories(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_partners_tenant ON crm.partners(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_branches_tenant ON crm.branches(tenant_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assignment_queues', 'territories', 'partners', 'branches'] LOOP
    EXECUTE format('ALTER TABLE crm.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE crm.%I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE policyname = t || '_tenant_isolation' AND schemaname = 'crm' AND tablename = t
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON crm.%I USING (tenant_id::text = current_setting(''app.tenant_id'', true))',
        t || '_tenant_isolation', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON crm.%I TO crm_svc', t);
    END IF;
  END LOOP;
END $$;
