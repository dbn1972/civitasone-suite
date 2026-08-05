-- Purpose: BRD §9.4 CRM↔Communication identifier mapping. crm.contact_communications
--   is a READ-side projection of the Communication Hub's per-recipient activity,
--   keyed to a CRM contact/lead/account via the externalReferenceId the hub carries.
--   It turns Customer-360's communication/campaign panels from `null·external` stubs
--   into REAL, tenant-owned counts (delivered/failed messages + campaign responses,
--   conversions and revenue). Fed by the `notification.contact_activity.recorded`
--   consumer (registerContactCommunicationConsumer). Tenant-scoped, FORCE RLS.
-- Rollback: DROP TABLE IF EXISTS crm.contact_communications;
-- Affected services: crm-service (communications module — contact-activity consumer + 360 read)
-- Sequencing: additive — a new tenant-scoped projection table, no FKs, no backfill.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.contact_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  subject_type varchar(16) NOT NULL
    CHECK (subject_type IN ('contact', 'lead', 'account')),
  -- The CRM contact/lead/account id (= the hub's externalReferenceId).
  subject_id uuid NOT NULL,
  kind varchar(24) NOT NULL
    CHECK (kind IN ('campaign_response', 'message_delivered', 'message_failed')),
  campaign_id uuid,
  campaign_recipient_id uuid,
  message_id text,
  provider_id text,
  status varchar(16) NOT NULL
    CHECK (status IN ('responded', 'converted', 'delivered', 'failed')),
  revenue_minor bigint,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid,
  -- Idempotency key that dedupes a re-emitted person-level activity even when the
  -- hub assigns a fresh messageId on redelivery: campaignRecipientId for responses,
  -- messageId for message delivery/failure. See consumer for the fallback chain.
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_communications_tenant_dedupe_uk UNIQUE (tenant_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_contact_communications_tenant
  ON crm.contact_communications(tenant_id);
-- The Customer-360 read: aggregate per subject.
CREATE INDEX IF NOT EXISTS idx_contact_communications_subject
  ON crm.contact_communications(tenant_id, subject_type, subject_id);

ALTER TABLE crm.contact_communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.contact_communications FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'contact_communications_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'contact_communications'
  ) THEN
    CREATE POLICY contact_communications_tenant_isolation ON crm.contact_communications
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.contact_communications TO crm_svc;
  END IF;
END $g$;
