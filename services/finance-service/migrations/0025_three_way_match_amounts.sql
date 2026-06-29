-- finance-service: R5 — real tri-leg PO↔GRN↔invoice 3-way match.
-- Additive, idempotent, forward-only.
--
-- Previously the bill-approve gate only checked that po_ref and grn_ref strings
-- were present — it never reconciled the invoice amount against what was ordered
-- (PO) or received (GRN). We now snapshot the authoritative PO and GRN(accepted)
-- values (derived server-side in procurement) onto the bill, and keep an AP
-- reconciliation read-model keyed by (tenant, grn_ref) populated from the
-- procurement.grn.accepted event so a manually-entered invoice citing the same
-- GRN can be reconciled too. The approve gate fails when the invoice exceeds
-- the GRN/PO value beyond tolerance (over-billing / pay-for-undelivered).

ALTER TABLE payments.finance_bills
  ADD COLUMN IF NOT EXISTS po_amount_minor  bigint,
  ADD COLUMN IF NOT EXISTS grn_amount_minor bigint;

-- AP three-way-match read-model: authoritative PO + GRN(accepted) values per
-- accepted GRN, sourced from procurement (DB-per-service: data arrives via the
-- grn.accepted event, never a cross-service JOIN).
CREATE TABLE IF NOT EXISTS payments.finance_grn_match (
  tenant_id        uuid        NOT NULL,
  grn_ref          text        NOT NULL,
  po_ref           text        NOT NULL,
  vendor_id        uuid        NOT NULL,
  po_amount_minor  bigint      NOT NULL DEFAULT 0,
  grn_amount_minor bigint      NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, grn_ref)
);

CREATE INDEX IF NOT EXISTS idx_finance_grn_match_po
  ON payments.finance_grn_match(tenant_id, po_ref);
