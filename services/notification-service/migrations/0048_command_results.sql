-- G-ASYNC-1: per-command terminal outcome, keyed by the messageId already
-- returned to the caller in every 202 response (see @civitasone/outbox's
-- commandResults doc comment for the full rationale). Lives alongside the
-- existing _inbox.processed idempotency table — same "consumer-side" home,
-- same schema, same per-service-database isolation.
--
-- DELIBERATELY NO ROW-LEVEL SECURITY, matching _inbox.processed (no RLS,
-- no tenant_id column at all) rather than a tenant-scoped domain table.
-- purgeOutbox() must delete old rows across ALL tenants with no
-- app.tenant_id GUC set, exactly like it already does for
-- _outbox.messages/_inbox.processed — this service's own worker.ts calls
-- startOutboxPurge(db, ...) with the regular tenant-scoped db (not a
-- BYPASSRLS scanner pool; this service's notification_scanner role is
-- documented read-only, see src/shared/scanner-db.ts), so command_results
-- has to be purgeable the exact same no-GUC way _outbox.messages already
-- is (that table's own FORCE RLS was dropped fleet-wide for this identical
-- reason — see NNNN_outbox_messages_drop_rls.sql). Tenant isolation for
-- READS is enforced explicitly instead, via an explicit tenantId filter in
-- @civitasone/outbox's getCommandOutcome() — not RLS. See that function's
-- doc comment.
CREATE TABLE IF NOT EXISTS _inbox.command_results (
  message_id  uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  topic       varchar(128) NOT NULL,
  status      varchar(16) NOT NULL CHECK (status IN ('succeeded', 'rejected', 'failed')),
  reason      text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_command_results_tenant ON _inbox.command_results(tenant_id);
