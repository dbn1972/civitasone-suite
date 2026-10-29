-- FQ12 (h): audit-service never got the G-ASYNC-1 `_inbox.command_results` table,
-- so audit-worker's startOutboxPurge() logs "relation _inbox.command_results does
-- not exist" every purge cycle (purgeOutbox in @civitasone/outbox deletes from it
-- unconditionally). Column shape is identical to notification-service
-- 0048_command_results.sql / procurement-service 0039_command_results.sql, so the
-- shared commandResults Drizzle table maps onto it.
--
-- Unlike those two, this copy carries tenant RLS (ENABLE + FORCE + policy, the
-- SEC-010 same-file rule). That is safe here because audit-service does not record
-- command outcomes today (no recordCommandOutcome caller). The purge's GUC-less
-- DELETE therefore just matches zero rows instead of failing on a missing
-- relation. If audit-service later adopts recordCommandOutcome it must write
-- inside runWithTenant (the documented contract), and its retention purge would
-- need a BYPASSRLS scanner pool like procurement's.
--
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS throughout.
-- Rollback: DROP TABLE IF EXISTS _inbox.command_results;
CREATE SCHEMA IF NOT EXISTS _inbox;

CREATE TABLE IF NOT EXISTS _inbox.command_results (
  message_id  uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  topic       varchar(128) NOT NULL,
  status      varchar(16) NOT NULL CHECK (status IN ('succeeded', 'rejected', 'failed')),
  reason      text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_command_results_tenant ON _inbox.command_results(tenant_id);

ALTER TABLE _inbox.command_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE _inbox.command_results FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON _inbox.command_results;
CREATE POLICY tenant_isolation_policy ON _inbox.command_results
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());
