-- Purpose: Fix status CHECK constraints on lifecycle.hrms_transfers,
--   lifecycle.hrms_promotions and lifecycle.hrms_rti_requests. Migration
--   0035 added CHECK constraints whose value whitelists were written from a
--   generic pending/approved/rejected/cancelled template and don't match the
--   actual application-level state machines implemented in
--   src/modules/lifecycle/routes.ts, src/modules/lifecycle/eoffice-consumer.ts,
--   src/modules/lifecycle/promotion-eoffice-consumer.ts and
--   src/modules/rti/routes.ts. This silently 500'd every transfer-order and
--   RTI-assignment write (masked in tests by an unrelated RLS bug that
--   aborted the affected test files before reaching these assertions).
--
--   hrms_transfers actual states: requested, ordered, relieved, joined,
--     pending_approval, completed, cancelled (plus legacy pending/approved/
--     rejected, kept for backward compatibility with any existing rows).
--   hrms_promotions actual states: pending_approval, completed (plus legacy
--     pending/approved/rejected/cancelled).
--   hrms_rti_requests actual states: filed, assigned, responded, appealed,
--     closed (plus acknowledged/transferred, kept for forward compatibility
--     with the CHECK constraint's original intent).
--
-- Rollback: re-run migration 0035's three DO blocks for these tables (this
--   file only widens the whitelist; the original narrower constraint can be
--   restored by dropping and re-adding with the 0035 value lists, provided
--   no row uses one of the newly-added states).
-- Affected services: hrms-service

SET lock_timeout = '5s';

-- ============================================================================
-- lifecycle.hrms_transfers.status — widen to include the real order lifecycle
-- ============================================================================
ALTER TABLE lifecycle.hrms_transfers
  DROP CONSTRAINT IF EXISTS hrms_transfers_status_check;
ALTER TABLE lifecycle.hrms_transfers
  ADD CONSTRAINT hrms_transfers_status_check
  CHECK (status IN (
    'pending', 'approved', 'rejected', 'completed', 'cancelled',
    'requested', 'ordered', 'relieved', 'joined', 'pending_approval'
  ))
  NOT VALID;

-- ============================================================================
-- lifecycle.hrms_promotions.status — widen to include the eOffice approval loop
-- ============================================================================
ALTER TABLE lifecycle.hrms_promotions
  DROP CONSTRAINT IF EXISTS hrms_promotions_status_check;
ALTER TABLE lifecycle.hrms_promotions
  ADD CONSTRAINT hrms_promotions_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'pending_approval', 'completed'))
  NOT VALID;

-- ============================================================================
-- lifecycle.hrms_rti_requests.status — add the "assigned" state used by
-- POST /v1/hrms/rti/requests/:id/assign-pio (filed -> assigned)
-- ============================================================================
ALTER TABLE lifecycle.hrms_rti_requests
  DROP CONSTRAINT IF EXISTS hrms_rti_requests_status_check;
ALTER TABLE lifecycle.hrms_rti_requests
  ADD CONSTRAINT hrms_rti_requests_status_check
  CHECK (status IN ('filed', 'acknowledged', 'assigned', 'responded', 'appealed', 'closed', 'transferred'))
  NOT VALID;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE lifecycle.hrms_transfers VALIDATE CONSTRAINT hrms_transfers_status_check;
ALTER TABLE lifecycle.hrms_promotions VALIDATE CONSTRAINT hrms_promotions_status_check;
ALTER TABLE lifecycle.hrms_rti_requests VALIDATE CONSTRAINT hrms_rti_requests_status_check;
