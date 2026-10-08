-- Purpose: GAP2-CRM-DEDUP-CANDIDATES-07 — persist DISMISSED duplicate pairs for
--   the post-save duplicate-review screen (/crm/dedup-candidates). The candidate
--   PAIRS themselves are recomputed live from crm.contacts via the tenant's
--   dedup rules (nothing to persist there — dedup is recomputed fresh), so this
--   table stores only the operator's decision to suppress a specific pair so it
--   does not resurface. pair_id is the order-independent "min_id:max_id" key.
-- Rollback: DROP TABLE IF EXISTS crm.dedup_dismissals;
-- Affected services: crm-service (contacts dedup-candidates routes)
-- Sequencing: additive — one new tenant-scoped table, no backfill, no column
--             changes. contact_a/contact_b carry no FK (a contact may be merged
--             away) so a stale dismissal simply never matches a live pair again.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.dedup_dismissals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  pair_id       varchar(128) NOT NULL,
  contact_a     uuid NOT NULL,
  contact_b     uuid NOT NULL,
  reason        varchar(500),
  dismissed_by  uuid NOT NULL,
  dismissed_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_dedup_dismissals_tenant_pair UNIQUE (tenant_id, pair_id)
);

CREATE INDEX IF NOT EXISTS idx_dedup_dismissals_tenant
  ON crm.dedup_dismissals(tenant_id);

ALTER TABLE crm.dedup_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.dedup_dismissals FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'dedup_dismissals_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'dedup_dismissals'
  ) THEN
    CREATE POLICY dedup_dismissals_tenant_isolation ON crm.dedup_dismissals
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.dedup_dismissals TO crm_svc;
  END IF;
END $g$;
