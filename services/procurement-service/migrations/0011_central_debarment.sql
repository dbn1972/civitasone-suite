-- procurement-service: R17 — federated (government-wide) vendor debarment.
-- Additive, idempotent, forward-only.
--
-- The vendor_blacklist was tenant-scoped only: a CVC/government-wide debarment
-- recorded by one tenant did not block the same firm in other tenants. A
-- debarment is against a legal entity (PAN), not a per-tenant vendor UUID. We
-- add a `scope` ('tenant' default | 'central') and the firm's `pan` so a
-- central debarment blocks that PAN across ALL tenants at the award/PO gate.

ALTER TABLE procurement.vendor_blacklist
  ADD COLUMN IF NOT EXISTS scope varchar(16) NOT NULL DEFAULT 'tenant',
  ADD COLUMN IF NOT EXISTS pan   text;

ALTER TABLE procurement.vendor_blacklist
  DROP CONSTRAINT IF EXISTS vendor_blacklist_scope_check;
ALTER TABLE procurement.vendor_blacklist
  ADD CONSTRAINT vendor_blacklist_scope_check CHECK (scope IN ('tenant', 'central'));

-- Fast lookup of an active central debarment by PAN (case-insensitive).
CREATE INDEX IF NOT EXISTS idx_vendor_blacklist_central_pan
  ON procurement.vendor_blacklist (upper(pan), status)
  WHERE scope = 'central';
