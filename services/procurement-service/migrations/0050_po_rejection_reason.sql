-- 0050_po_rejection_reason.sql
-- UAT bundle 22 (W2): a PO rejected by its checker was stored as "cancelled" and the reason the checker
-- gave was dropped, so the maker saw neither "Rejected" nor why. A rejected PO now ends in "rejected"
-- (already allowed by procurement_pos_status_check since 0008) and keeps the reason here.
--
-- Additive + idempotent; existing rows keep NULL. POs rejected before this change stay "cancelled":
-- a cancelled PO cannot be told from one cancelled through its approved lifecycle, so they are not re-labelled.
-- Rollback:
--   ALTER TABLE po.procurement_pos DROP COLUMN IF EXISTS rejection_reason;
--   (rows with status 'rejected' then need UPDATE ... SET status='cancelled' first if the old label is wanted)
-- Affected services: procurement-service (po module), web (PO detail)

SET lock_timeout = '5s';

ALTER TABLE po.procurement_pos
  ADD COLUMN IF NOT EXISTS rejection_reason text;
