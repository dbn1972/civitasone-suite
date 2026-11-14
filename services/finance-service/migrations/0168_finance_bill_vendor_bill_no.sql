-- 0168_finance_bill_vendor_bill_no.sql
-- POST /v1/finance/bills used to drop the caller's bill number (the internal BILL/<fy>/<seq> number is allocated by the
-- gapless allocator) so a seed or an accounts clerk re-submitting the same vendor invoice created a second bill (6
-- duplicate bills in SMC). The vendor's own invoice number is now kept on the bill:
--  1. payments.finance_bills.vendor_bill_no: the number the vendor printed on its invoice (NULL for bills raised from a
--     GRN / works bill and for every bill that exists today). bill_no stays the internal number and stays unique.
--  2. A NON-unique lookup index for the per-vendor duplicate check. It is deliberately not a UNIQUE index: the duplicate
--     refusal (409 DUPLICATE_VENDOR_BILL_NO) is switched on per deployment with FINANCE_VENDOR_BILL_NO_UNIQUE and is off
--     by default, so today's behaviour (a repeat is accepted) is unchanged until it is on.
-- Additive and idempotent. Numbering: finance 0165 (#2509), 0166 (#2468) are taken by open PRs and 0167 by the AR
-- opening-import PR, so this is 0168.
-- Rollback: DROP INDEX payments.idx_finance_bills_vendor_bill_no; ALTER TABLE payments.finance_bills DROP COLUMN vendor_bill_no.

SET lock_timeout = '5s';

ALTER TABLE payments.finance_bills ADD COLUMN IF NOT EXISTS vendor_bill_no text;

CREATE INDEX IF NOT EXISTS idx_finance_bills_vendor_bill_no
  ON payments.finance_bills (tenant_id, vendor_id, (lower(regexp_replace(btrim(vendor_bill_no), '\s+', ' ', 'g'))))
  WHERE vendor_bill_no IS NOT NULL;
