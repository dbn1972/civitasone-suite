-- Migration: 0027_order_compliance_fields
-- Purpose: GAP-LEGAL-COURT-ORDERS-NEW-01. The Court Orders dashboard counts
--   "Compliance Due" and "Contempt Risk" from complianceRequired /
--   complianceDeadline, but hearings.legal_orders had NEITHER column: the
--   record-order flow (RecordOrderForm → POST /v1/legal/cases/:id/orders →
--   recordOrderBody) carried no compliance fields, and listCourtOrderSummaries
--   faked complianceRequired as Boolean(direction) with the deadline always
--   null. Orders recorded through the UI could therefore never surface as due
--   or at-risk, hiding real court-direction deadlines (contempt exposure).
--   This adds the two columns so the deadline can be recorded and tracked.
-- Rollback:
--   ALTER TABLE hearings.legal_orders DROP COLUMN IF EXISTS compliance_required;
--   ALTER TABLE hearings.legal_orders DROP COLUMN IF EXISTS compliance_deadline;
-- Affected services: legal-service

SET lock_timeout = '5s';

ALTER TABLE hearings.legal_orders
  ADD COLUMN IF NOT EXISTS compliance_required BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE hearings.legal_orders
  ADD COLUMN IF NOT EXISTS compliance_deadline DATE;

-- Backfill: existing rows that recorded a `direction` were previously treated
-- as compliance-required by the list query's Boolean(direction) heuristic, so
-- preserve that interpretation for already-stored rows (deadline stays NULL —
-- unknown, not fabricated).
UPDATE hearings.legal_orders
  SET compliance_required = TRUE
  WHERE direction IS NOT NULL AND compliance_required = FALSE;
