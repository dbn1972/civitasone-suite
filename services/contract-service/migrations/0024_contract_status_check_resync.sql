-- 0024_contract_status_check_resync.sql
-- UAT DB sweep 2026-10-28 (g4): POST /v1/contract/contracts/:id/submit-approval returned 202 but the
-- consumer UPDATE (status=pending_approval) was rejected by the LIVE contract_contracts_status_check
-- (retried to DLQ; contract stayed draft). Migration 0005 adds that constraint inside a
-- DO block that swallows duplicate_object, so a database where an older constraint of the same name
-- already existed (without pending_approval) silently kept the stale definition.
-- This drops and re-creates the constraint with the full state set from domain.ts + 0005.
-- Added NOT VALID so existing rows are never scanned/rejected; new writes are checked.
-- Idempotent (DROP IF EXISTS + ADD). No monetary columns touched.
-- Rollback: re-run 0005 after dropping contract_contracts_status_check.
-- Affected services: contract-service

SET lock_timeout = '5s';

ALTER TABLE contracts.contract_contracts DROP CONSTRAINT IF EXISTS contract_contracts_status_check;
ALTER TABLE contracts.contract_contracts
  ADD CONSTRAINT contract_contracts_status_check
  CHECK (status IN ('draft', 'pending_approval', 'approved', 'active', 'closed', 'terminated', 'expired', 'renewed', 'suspended'))
  NOT VALID;
