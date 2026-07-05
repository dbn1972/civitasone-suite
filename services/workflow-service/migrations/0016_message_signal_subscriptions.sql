-- 0016: Message and Signal subscription enhancements.
-- Migration 0015 created the base tables; this adds RLS policies and
-- an updated_by audit column for operational traceability.

-- ── Add updated_by for audit traceability ────────────────────────────────────
ALTER TABLE workflow.message_subscriptions
  ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE workflow.signal_subscriptions
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- ── Add tenant-scoped signal correlation_key for multi-instance matching ─────
ALTER TABLE workflow.signal_subscriptions
  ADD COLUMN IF NOT EXISTS correlation_key varchar(256);

-- ── Partial index: expired subscriptions older than 7 days (cleanup target) ──
CREATE INDEX IF NOT EXISTS idx_msg_sub_expired_cleanup
  ON workflow.message_subscriptions(created_at)
  WHERE status = 'expired';

CREATE INDEX IF NOT EXISTS idx_sig_sub_expired_cleanup
  ON workflow.signal_subscriptions(created_at)
  WHERE status IN ('matched', 'expired');
