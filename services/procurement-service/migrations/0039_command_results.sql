-- G-ASYNC-1: per-command terminal outcome, keyed by the messageId already
-- returned to the caller in every 202 response (see @civitasone/outbox's
-- commandResults doc comment for the full rationale). Lives alongside the
-- existing _inbox.processed idempotency table — same "consumer-side" home,
-- same schema, same per-service-database isolation.
CREATE TABLE IF NOT EXISTS _inbox.command_results (
  message_id  uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  topic       varchar(128) NOT NULL,
  status      varchar(16) NOT NULL CHECK (status IN ('succeeded', 'rejected', 'failed')),
  reason      text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_command_results_tenant ON _inbox.command_results(tenant_id);

-- Same RLS convention as every tenant-scoped table in this service (see e.g.
-- migrations/0010_rls_tenant_isolation.sql's indent.current_tenant_id()) —
-- scoped to _inbox itself since this table isn't owned by any one business
-- module (indent/vendor/po/tender/...), it is cross-cutting queue plumbing.
CREATE OR REPLACE FUNCTION _inbox.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

ALTER TABLE _inbox.command_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE _inbox.command_results FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON _inbox.command_results;
CREATE POLICY tenant_isolation ON _inbox.command_results
  USING (tenant_id = _inbox.current_tenant_id());
