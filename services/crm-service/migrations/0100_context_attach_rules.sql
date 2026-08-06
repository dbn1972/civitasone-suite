-- G22: Context-attach rule engine for automatic inbound event linking.
-- Rollback: DROP TABLE IF EXISTS crm.context_attachments; DROP TABLE IF EXISTS crm.context_attach_rules;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.context_attach_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  name         varchar(200) NOT NULL,
  event_type   varchar(64) NOT NULL,
  match_field  varchar(64) NOT NULL,
  match_target varchar(16) NOT NULL CHECK (match_target IN ('account', 'contact', 'deal', 'case')),
  target_field varchar(64) NOT NULL,
  action       varchar(16) NOT NULL CHECK (action IN ('link_activity', 'link_document', 'create_task')),
  active       boolean NOT NULL DEFAULT true,
  priority     integer NOT NULL DEFAULT 0,
  version      integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_context_attach_rules_tenant
  ON crm.context_attach_rules (tenant_id, active, event_type);

CREATE TABLE IF NOT EXISTS crm.context_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  rule_id     uuid NOT NULL REFERENCES crm.context_attach_rules(id),
  event_ref   varchar(128) NOT NULL,
  target_type varchar(16) NOT NULL,
  target_id   uuid NOT NULL,
  attached_at timestamptz NOT NULL DEFAULT now(),
  metadata    jsonb NOT NULL DEFAULT '{}',
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_context_attachments_target
  ON crm.context_attachments (tenant_id, target_type, target_id);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_context_attachments_event_ref
  ON crm.context_attachments (tenant_id, rule_id, event_ref);
