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
-- _outbox.messages/_inbox.processed — this is the SAME reason
-- _outbox.messages had its own FORCE RLS deliberately dropped fleet-wide
-- (see this service's own NNNN_outbox_messages_drop_rls.sql: "a bare
-- cross-tenant SELECT/DELETE with no app.tenant_id GUC set returns/touches
-- ZERO rows under FORCE RLS — the relay/purge would silently no-op").
-- Tenant isolation for READS is enforced explicitly instead, via an
-- explicit tenantId filter in @civitasone/outbox's getCommandOutcome() —
-- not RLS. See that function's doc comment.
CREATE TABLE IF NOT EXISTS _inbox.command_results (
  message_id  uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  topic       varchar(128) NOT NULL,
  status      varchar(16) NOT NULL CHECK (status IN ('succeeded', 'rejected', 'failed')),
  reason      text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_command_results_tenant ON _inbox.command_results(tenant_id);

-- This service's worker.ts runs startOutboxPurge() as the BYPASSRLS
-- procurement_scanner role (see shared/scanner-db.ts), not the regular
-- procurement_svc role — 0027_procurement_scanner_role.sql granted that
-- role SELECT/DELETE on _outbox.messages/_inbox.processed for exactly this
-- purge loop, but obviously couldn't have granted anything on this table,
-- which didn't exist yet. Without this grant, purgeOutbox()'s new
-- command_results loop would fail with "permission denied" every cycle
-- when invoked via scannerDb — caught and logged by startOutboxPurge's own
-- error handling (so it wouldn't crash the worker), but command_results
-- would never actually get purged in this service. Live-verified: this
-- exact failure reproduces without the grant below, and is fixed by it.
GRANT SELECT, DELETE ON _inbox.command_results TO procurement_scanner;
