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
-- ATOMIC: scripts/dev/migrate-all.mjs runs psql WITHOUT --single-transaction,
-- so a separate DROP statement would commit on its own and a failing ADD would
-- leave the table with NO check at all. The whole drop + re-add is therefore a
-- single DO block (one statement = one transaction): any error rolls back the
-- DROP too and the original constraint survives.
--
-- SAFE ON BAD DATA: if any existing row falls outside the new set, the block
-- RAISEs NOTICE and changes nothing (original constraint kept). VALIDATE runs
-- in a guarded sub-block: a row slipping in concurrently leaves the new
-- constraint NOT VALID (still enforced for new writes) and RAISEs NOTICE.
--
-- IDEMPOTENT: re-running drops and re-creates the same definition.
-- lock_timeout bounds the ACCESS EXCLUSIVE wait so a busy table fails fast
-- (rolled back, re-runnable) instead of queueing behind long transactions.
-- ============================================================================
SET lock_timeout = '5s';

DO $$
DECLARE
  bad_rows bigint;
BEGIN
  SELECT count(*) INTO bad_rows
    FROM settlements.legal_settlements
   WHERE status NOT IN ('draft', 'proposed', 'accepted', 'rejected', 'executed', 'settled');

  IF bad_rows > 0 THEN
    RAISE NOTICE '0037: % settlement row(s) have a status outside the reconciled set; keeping the existing legal_settlements_status_check unchanged', bad_rows;
    RETURN;
  END IF;

  ALTER TABLE settlements.legal_settlements
    DROP CONSTRAINT IF EXISTS legal_settlements_status_check;

  ALTER TABLE settlements.legal_settlements
    ADD CONSTRAINT legal_settlements_status_check
    CHECK (status IN ('draft', 'proposed', 'accepted', 'rejected', 'executed', 'settled'))
    NOT VALID;

  BEGIN
    ALTER TABLE settlements.legal_settlements VALIDATE CONSTRAINT legal_settlements_status_check;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '0037: legal_settlements_status_check left NOT VALID (a violating row appeared during validation); it is still enforced for new writes';
  END;
END
$$;
