-- Purpose: AC-004 email/calendar sync — LINKING SUBSTRATE ONLY (framework).
--   * crm.linked_accounts stores a user's connected mailbox/calendar provider
--     config (google/o365/imap/caldav) as status='pending' — NO live OAuth/IMAP/
--     CalDAV is performed by this service; connecting only records intent.
--   * crm.synced_items links an externally-synced email/meeting to a CRM record
--     so the AC's linked to relevant records is representable.
--   Live provider sync (token exchange, polling) is DEFERRED — see module comments.
-- Rollback: DROP TABLE IF EXISTS crm.synced_items; DROP TABLE IF EXISTS crm.linked_accounts;
-- Affected services: crm-service (integrations module)

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.linked_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  provider varchar(8) NOT NULL CHECK (provider IN ('google', 'o365', 'imap', 'caldav')),
  external_email varchar(320) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'error')),
  scopes jsonb NOT NULL DEFAULT '[]',
  connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

-- One live link per (user, provider, mailbox).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_linked_accounts_user_provider_email
  ON crm.linked_accounts(tenant_id, user_id, provider, external_email);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_linked_accounts_tenant ON crm.linked_accounts(tenant_id);

CREATE TABLE IF NOT EXISTS crm.synced_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  linked_account_id uuid NOT NULL,
  kind varchar(8) NOT NULL CHECK (kind IN ('email', 'meeting')),
  external_id varchar(320) NOT NULL,
  subject_type varchar(16) NOT NULL CHECK (subject_type IN ('contact', 'account', 'deal')),
  subject_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

-- Idempotent linking: the same external item is linked once per account.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_synced_items_external
  ON crm.synced_items(tenant_id, linked_account_id, external_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_synced_items_subject
  ON crm.synced_items(tenant_id, subject_type, subject_id);

ALTER TABLE crm.linked_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.linked_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.synced_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.synced_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'linked_accounts_tenant_isolation' AND schemaname='crm' AND tablename='linked_accounts') THEN
    CREATE POLICY linked_accounts_tenant_isolation ON crm.linked_accounts
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'synced_items_tenant_isolation' AND schemaname='crm' AND tablename='synced_items') THEN
    CREATE POLICY synced_items_tenant_isolation ON crm.synced_items
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.linked_accounts TO crm_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.synced_items TO crm_svc;
  END IF;
END $g$;
