-- Purpose: AC-003 structured communication log. crm.communications records every
--   inbound/outbound interaction (call/email/sms/whatsapp/portal/meeting/other)
--   against a contact/account/deal, so it appears chronologically on the timeline
--   with a direction, outcome and disposition. Tenant-scoped, FORCE RLS.
-- Rollback: DROP TABLE IF EXISTS crm.communications;
-- Affected services: crm-service (communications module)
-- Sequencing: additive — a new tenant-scoped table, no FKs, no backfill.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  subject_type varchar(16) NOT NULL
    CHECK (subject_type IN ('contact', 'account', 'deal')),
  subject_id uuid NOT NULL,
  direction varchar(8) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  channel varchar(12) NOT NULL
    CHECK (channel IN ('email', 'phone', 'sms', 'whatsapp', 'portal', 'meeting', 'other')),
  outcome text,
  disposition text,
  summary text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  logged_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_communications_tenant ON crm.communications(tenant_id);
-- The timeline read: chronological per subject.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_communications_subject
  ON crm.communications(tenant_id, subject_type, subject_id, occurred_at DESC);

ALTER TABLE crm.communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.communications FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'communications_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'communications'
  ) THEN
    CREATE POLICY communications_tenant_isolation ON crm.communications
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.communications TO crm_svc;
  END IF;
END $g$;
