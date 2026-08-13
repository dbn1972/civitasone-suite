-- Purpose: create helpdesk.canned_responses for the canned-responses module.
-- Provides pre-written reply templates that agents can insert into tickets.
-- Rollback: DROP TABLE IF EXISTS helpdesk.canned_responses;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.canned_responses (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  title       text        NOT NULL,
  content     text        NOT NULL,
  category    varchar(64),
  short_code  varchar(32),
  tags        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  enabled     boolean     NOT NULL DEFAULT true,
  created_by  uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canned_responses_tenant_idx
  ON helpdesk.canned_responses(tenant_id);
CREATE INDEX IF NOT EXISTS canned_responses_category_idx
  ON helpdesk.canned_responses(tenant_id, category) WHERE enabled = true;

ALTER TABLE helpdesk.canned_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.canned_responses FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON helpdesk.canned_responses;
CREATE POLICY tenant_isolation ON helpdesk.canned_responses
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
