-- ============================================================================
-- 0037 — reconcile settlements.legal_settlements.status CHECK (FQ9 #2)
--
-- 0011 created legal_settlements_status_check as ('draft','settled'), but the
-- UAT database carries a drifted definition ('draft','proposed','accepted',
-- 'rejected','executed') that rejects 'settled', so every
-- legal.settlement.create dead-lettered. The consumer now writes 'executed'
-- (the settlement lifecycle's terminal state). This migration converges every
-- environment on ONE definition: the lifecycle set plus the legacy 'settled'
-- value, so rows written under either earlier definition stay valid.
--
-- Idempotent: drop-if-exists + re-add NOT VALID, then VALIDATE (no long lock
-- on ADD; VALIDATE only takes SHARE UPDATE EXCLUSIVE). Safe to re-run.
-- ============================================================================
ALTER TABLE settlements.legal_settlements
  DROP CONSTRAINT IF EXISTS legal_settlements_status_check;

ALTER TABLE settlements.legal_settlements
  ADD CONSTRAINT legal_settlements_status_check
  CHECK (status IN ('draft', 'proposed', 'accepted', 'rejected', 'executed', 'settled'))
  NOT VALID;

ALTER TABLE settlements.legal_settlements VALIDATE CONSTRAINT legal_settlements_status_check;
