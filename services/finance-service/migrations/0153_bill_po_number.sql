-- 0153_bill_po_number.sql
-- GAP-FINANCE-EXPENDITURE-BILLS-06: a bill carries only the opaque cross-service reference po_ref
-- ("procurement_po:<uuid>"), so the Bills register and the bill detail could show a clerk nothing better than a
-- shortened id. Snapshot the human PO number that procurement already sends on procurement.grn.accepted (poNo) onto the
-- bill when it is drafted from a GRN, so the register shows "PO-2026-014" and links to the purchase order.
-- Nullable: bills lodged by hand, and bills drafted before this migration, have no number and fall back to the id form.
-- A display snapshot only: po_ref stays the authoritative link, and nothing computes from this column.
-- Additive + idempotent. Safe to re-run.
-- Rollback: ALTER TABLE payments.finance_bills DROP COLUMN IF EXISTS po_number;

SET lock_timeout = '5s';

ALTER TABLE payments.finance_bills ADD COLUMN IF NOT EXISTS po_number text;
