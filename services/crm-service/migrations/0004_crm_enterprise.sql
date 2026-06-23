-- CRM Phase 2: Oracle/SAP/Salesforce parity — rich contacts, accounts, linkage, consent

CREATE TABLE IF NOT EXISTS crm.accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  name         varchar(200) NOT NULL,
  industry     varchar(64),
  website      varchar(320),
  status       varchar(24) NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_accounts_tenant ON crm.accounts(tenant_id);

ALTER TABLE crm.contacts
  ADD COLUMN IF NOT EXISTS designation varchar(120),
  ADD COLUMN IF NOT EXISTS city varchar(100),
  ADD COLUMN IF NOT EXISTS country char(2) DEFAULT 'IN',
  ADD COLUMN IF NOT EXISTS lead_status varchar(24) NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS lead_source varchar(64),
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES crm.accounts(id),
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS marketing_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_date date,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_contacts_owner ON crm.contacts(tenant_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_contacts_lead ON crm.contacts(tenant_id, lead_status);
CREATE INDEX IF NOT EXISTS idx_contacts_search ON crm.contacts(tenant_id, name);

ALTER TABLE crm.deals
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES crm.contacts(id),
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS close_date date,
  ADD COLUMN IF NOT EXISTS probability integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_deals_contact ON crm.deals(tenant_id, contact_id);

ALTER TABLE crm.activities
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES crm.contacts(id),
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES crm.deals(id),
  ADD COLUMN IF NOT EXISTS type varchar(16) NOT NULL DEFAULT 'note',
  ADD COLUMN IF NOT EXISTS subject varchar(200),
  ADD COLUMN IF NOT EXISTS status varchar(24) NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_activities_contact ON crm.activities(tenant_id, contact_id, created_at DESC);
