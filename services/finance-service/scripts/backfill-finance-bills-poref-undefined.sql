-- services/finance-service/scripts/backfill-finance-bills-poref-undefined.sql
--
-- One-time data repair for PR #1478 (raw-values-leaked-to-ui / Bug A).
--
-- Root cause: integrations/consumer.ts's procurement.grn.accepted handler
-- used to unconditionally build `procurement_po:${p.poRef}` with no guard
-- against p.poRef being missing or already-stringified-nullish, so a
-- producer-side gap silently manufactured the literal string
-- "procurement_po:undefined" instead of leaving the bill genuinely
-- unlinked. The code path is fixed (see integrations/consumer.ts); this
-- script is ONLY the one-time repair for the 5 rows that already existed
-- with the bad value in the shared dev DB (civitas_finance) at the time
-- this was found, kept here for audit/reference and so it can be re-run
-- safely (it is a no-op) or adapted if the same shape ever needs repairing
-- again elsewhere.
--
-- For each affected bill, the correct value was derived by resolving its
-- linked GRN's own po_ref column (grn.procurement_grns in the procurement
-- DB, civitas_procurement) — never fabricated. Three of five GRNs resolved
-- to a real, still-existing PO; the other two reference a PO id that does
-- not exist in po.procurement_pos at all (a separate, pre-existing dangling
-- GRN->PO reference, not something this script invents a value for) and
-- were set to NULL so the UI renders an honest "not linked" state instead.
--
-- Idempotent: every UPDATE is guarded by `WHERE po_ref = 'procurement_po:undefined'`,
-- so re-running this against a DB where the repair has already been applied
-- (or where these specific rows don't exist) affects zero rows.
--
-- Run against civitas_finance, e.g.:
--   docker exec civitasone-postgres psql -U civitas_admin -d civitas_finance -f backfill-finance-bills-poref-undefined.sql

BEGIN;

UPDATE payments.finance_bills SET po_ref = 'procurement_po:c900b2a3-f9ec-4171-8ee3-bbf286da3613'
  WHERE id = 'af199a38-de2d-487a-ac3f-82da93e91be4'::uuid AND po_ref = 'procurement_po:undefined';

UPDATE payments.finance_bills SET po_ref = 'procurement_po:c78d6089-3494-4267-99c2-2972b4fc56c4'
  WHERE id = '4b39c88c-d374-4b99-9b96-034a5d1ff652'::uuid AND po_ref = 'procurement_po:undefined';

UPDATE payments.finance_bills SET po_ref = 'procurement_po:e9094df9-d775-45f9-bac7-ce7261af50df'
  WHERE id = '6c2a715e-bd78-4afa-85be-dcb398619d59'::uuid AND po_ref = 'procurement_po:undefined';

-- Genuinely-unlinked: the GRNs behind these two bills reference PO ids that
-- do not exist in po.procurement_pos (verified via a LEFT JOIN against that
-- table returning no match) -- honest NULL, not a fabricated reference.
UPDATE payments.finance_bills SET po_ref = NULL
  WHERE id IN ('3378190b-c7d5-4674-9986-496944553911'::uuid, '921ee0f5-be78-4472-89fc-a0a3635a78bd'::uuid)
  AND po_ref = 'procurement_po:undefined';

COMMIT;

-- Verification: expect zero rows.
SELECT id, bill_no, po_ref FROM payments.finance_bills WHERE po_ref = 'procurement_po:undefined';
