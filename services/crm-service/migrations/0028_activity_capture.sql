-- Purpose: Create crm.captured_activities — automatic email/calendar activity
--          capture with contact matching (AC-004, WC-003) and a capture-health
--          read model (WC-004).
-- Rollback: DROP TABLE IF EXISTS crm.captured_activities;
-- Affected services: crm-service
--
-- DPDP / PII note (deliberate design, do not "fix"):
--   This table intentionally stores NO message body. Only the subject line,
--   participant handles supplied by the connector, and `raw_ref` — an opaque
--   pointer to the message in the source system (Graph/Gmail/Calendar id or an
--   object-store key). Keeping bodies out of the CRM database limits the DPDP
--   Act 2023 personal-data footprint and keeps the erasure story simple: delete
--   the pointer, and the CRM holds no correspondence content.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.captured_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source varchar(16) NOT NULL CHECK (source IN ('email', 'calendar')),
  external_id varchar(200) NOT NULL,
  contact_id uuid,
  subject varchar(500),
  occurred_at timestamptz,
  participants jsonb NOT NULL DEFAULT '[]',
  match_confidence numeric(5, 4),
  match_status varchar(16) NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('matched', 'unmatched', 'ambiguous')),
  -- Pointer only. NEVER the message body. See DPDP note above.
  raw_ref varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  version integer NOT NULL DEFAULT 1,
  -- Connectors re-deliver: the source id is the idempotency key for ingest.
  CONSTRAINT captured_activities_tenant_source_external_uk UNIQUE (tenant_id, source, external_id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_captured_activities_tenant_id ON crm.captured_activities(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_captured_activities_contact_id ON crm.captured_activities(contact_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_captured_activities_match_status ON crm.captured_activities(tenant_id, match_status);

ALTER TABLE crm.captured_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.captured_activities FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'captured_activities_tenant_isolation' AND tablename = 'captured_activities'
  ) THEN
    CREATE POLICY captured_activities_tenant_isolation ON crm.captured_activities
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.captured_activities TO crm_svc;
  END IF;
END $g$;
