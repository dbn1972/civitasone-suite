-- Req 1.2 (estab-inv-int-go-live) — GRN partial-delivery amendment.
--
-- Purpose: widen grn.procurement_grns.status CHECK constraint to allow
-- 'under_inspection', per the GRN state machine documented in
-- docs/specs/estab-inv-int-go-live/design.md §2:
--   draft -> under_inspection -> accepted | rejected
-- The constraint added in 0015_check_constraints_status_columns.sql only
-- allowed ('draft', 'accepted', 'rejected', 'partial') and predates this
-- state. This migration is additive (widens the allowed set only; no
-- existing value is removed) and idempotent (safe to re-run).
--
-- Rollback: re-run 0015's original CHECK
--   (CHECK (status IN ('draft', 'accepted', 'rejected', 'partial')))
--   after confirming no row currently has status = 'under_inspection'.
-- Affected services: procurement-service (grn.procurement_grns only).

SET lock_timeout = '5s';

DO $$ BEGIN
  ALTER TABLE grn.procurement_grns
    DROP CONSTRAINT IF EXISTS procurement_grns_status_check;
  ALTER TABLE grn.procurement_grns
    ADD CONSTRAINT procurement_grns_status_check
    CHECK (status IN ('draft', 'under_inspection', 'accepted', 'rejected', 'partial'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE grn.procurement_grns VALIDATE CONSTRAINT procurement_grns_status_check;
