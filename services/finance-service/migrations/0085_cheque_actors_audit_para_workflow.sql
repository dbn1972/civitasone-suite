-- Migration 0085: cheque lifecycle actors + stale/re-present, audit-para workflow (fp-finance-02)
--
-- GAP-FINANCE-TREASURY-CHEQUES-DETAIL-03 / -04:
--  * per-transition actor columns on treasury.finance_instruments so the
--    clearance timeline can name who presented / cleared / bounced / cancelled
--    (created_by is the issuer). Rows that transitioned before this migration
--    have NULL actors; the UI shows no actor for them rather than guessing.
--  * cancel_reason (mandatory on new cancels), represent_* (bounced ->
--    presented again), staled_* (issued past the validity horizon -> 'stale';
--    the status CHECK already admits 'stale', see 0056).
-- GAP-FINANCE-AUDIT-PARAS-DETAIL-04:
--  * audit.finance_audit_para_events: the append-only reply / escalate / settle
--    trail for a CAG / AG / internal audit para; audit.finance_audit_paras gets
--    responded_by so the maker != checker rule on settle can be enforced in one
--    conditional UPDATE.

ALTER TABLE treasury.finance_instruments ADD COLUMN IF NOT EXISTS presented_by uuid;
ALTER TABLE treasury.finance_instruments ADD COLUMN IF NOT EXISTS cleared_by uuid;
ALTER TABLE treasury.finance_instruments ADD COLUMN IF NOT EXISTS bounced_by uuid;
ALTER TABLE treasury.finance_instruments ADD COLUMN IF NOT EXISTS cancelled_by uuid;
ALTER TABLE treasury.finance_instruments ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE treasury.finance_instruments ADD COLUMN IF NOT EXISTS represent_count integer NOT NULL DEFAULT 0;
ALTER TABLE treasury.finance_instruments ADD COLUMN IF NOT EXISTS last_represented_at timestamptz;
ALTER TABLE treasury.finance_instruments ADD COLUMN IF NOT EXISTS last_represented_by uuid;
ALTER TABLE treasury.finance_instruments ADD COLUMN IF NOT EXISTS represent_reason text;
ALTER TABLE treasury.finance_instruments ADD COLUMN IF NOT EXISTS staled_at timestamptz;
ALTER TABLE treasury.finance_instruments ADD COLUMN IF NOT EXISTS staled_by uuid;

ALTER TABLE audit.finance_audit_paras ADD COLUMN IF NOT EXISTS responded_by uuid;

CREATE TABLE IF NOT EXISTS audit.finance_audit_para_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  para_id     uuid NOT NULL,
  action      varchar(16) NOT NULL,
  from_status varchar(24) NOT NULL,
  to_status   varchar(24) NOT NULL,
  note        text NOT NULL,
  actor_id    uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_audit_para_event_action CHECK (action IN ('respond', 'escalate', 'settle'))
);
CREATE INDEX IF NOT EXISTS idx_audit_para_events_para ON audit.finance_audit_para_events(tenant_id, para_id, created_at);

ALTER TABLE audit.finance_audit_para_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.finance_audit_para_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON audit.finance_audit_para_events;
CREATE POLICY tenant_isolation_policy ON audit.finance_audit_para_events
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());
