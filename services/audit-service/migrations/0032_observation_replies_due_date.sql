-- 0032_observation_replies_due_date.sql
-- AUDIT-OBS: (1) persist auditee compliance replies (previously the reply text was
-- accepted and then dropped, so the detail view hard-coded replies:[]), and
-- (2) add an optional compliance due date to observations.
-- Additive & idempotent. New table: tenant_id + ENABLE/FORCE RLS + tenant_isolation
--   policy (events.current_tenant_id()), mirroring 0013_rls_full_tenant_isolation.sql.
-- Rollback: DROP TABLE observation.audit_observation_replies;
--           ALTER TABLE observation.audit_observations DROP COLUMN due_date;
-- Affected services: audit-service only.

SET lock_timeout = '5s';

ALTER TABLE observation.audit_observations ADD COLUMN IF NOT EXISTS due_date date;

CREATE TABLE IF NOT EXISTS observation.audit_observation_replies (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  observation_id   uuid        NOT NULL,
  reply_text       text        NOT NULL,
  responded_by_ref text        NOT NULL,
  attachment_ref   text,
  decision         varchar(16),
  decision_remarks text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  CONSTRAINT audit_observation_replies_decision_check CHECK (decision IS NULL OR decision IN ('accepted','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_audit_observation_replies_obs ON observation.audit_observation_replies (tenant_id, observation_id, created_at);

ALTER TABLE observation.audit_observation_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation.audit_observation_replies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON observation.audit_observation_replies;
CREATE POLICY tenant_isolation_policy ON observation.audit_observation_replies
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());
