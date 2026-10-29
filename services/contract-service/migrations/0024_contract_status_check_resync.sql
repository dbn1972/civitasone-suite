-- 0024_contract_status_check_resync.sql
-- UAT DB sweep 2026-10-28 (g4): POST /v1/contract/contracts/:id/submit-approval returned 202 but the
-- consumer UPDATE (status=pending_approval) was rejected by the LIVE contract_contracts_status_check
-- (retried to DLQ; contract stayed draft). Migration 0005 adds that constraint inside a
-- DO block that swallows duplicate_object, so a database where an older constraint of the same name
-- already existed (without pending_approval) silently kept the stale definition.
-- This drops and re-creates the constraint with the full state set from domain.ts + 0005.
-- Added NOT VALID first (new writes checked at once), then VALIDATEd (0005 pattern) in a guarded block:
-- if a drifted DB holds a row with an out-of-set status, VALIDATE is skipped with a NOTICE listing the
-- offending statuses instead of aborting the migration (constraint stays NOT VALID but enforced for new writes).
-- Idempotent (DROP IF EXISTS + ADD). No monetary columns touched.
-- Rollback: re-run 0005 after dropping contract_contracts_status_check.
-- Affected services: contract-service

SET lock_timeout = '5s';

ALTER TABLE contracts.contract_contracts DROP CONSTRAINT IF EXISTS contract_contracts_status_check;
ALTER TABLE contracts.contract_contracts
  ADD CONSTRAINT contract_contracts_status_check
  CHECK (status IN ('draft', 'pending_approval', 'approved', 'active', 'closed', 'terminated', 'expired', 'renewed', 'suspended'))
  NOT VALID;

DO $$
DECLARE
  bad text;
BEGIN
  -- Best-effort listing (FORCE RLS may hide rows from a role without the tenant GUC; VALIDATE scans all rows).
  SELECT string_agg(DISTINCT coalesce(status, '<NULL>'), ', ') INTO bad
    FROM contracts.contract_contracts
   WHERE status IS NULL
      OR status NOT IN ('draft', 'pending_approval', 'approved', 'active', 'closed', 'terminated', 'expired', 'renewed', 'suspended');
  IF bad IS NOT NULL THEN
    RAISE NOTICE 'contract_contracts_status_check left NOT VALID: existing rows have statuses outside the allowed set: %', bad;
  ELSE
    BEGIN
      ALTER TABLE contracts.contract_contracts VALIDATE CONSTRAINT contract_contracts_status_check;
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'contract_contracts_status_check left NOT VALID: existing rows violate it (not visible to this role; fix data, then re-run VALIDATE CONSTRAINT)';
    END;
  END IF;
END
$$;
