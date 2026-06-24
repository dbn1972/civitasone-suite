-- 0007_wave1_hardening.sql
-- Wave 1 security + correctness hardening. Additive + idempotent only.

-- ── Blacklist: reconcile procurement.vendor_blacklist with the API shape ───────
-- The deployed table shape varies across environments; add every column the
-- service needs, idempotently, regardless of which subset already exists.
ALTER TABLE procurement.vendor_blacklist ADD COLUMN IF NOT EXISTS blacklisted_from DATE;
ALTER TABLE procurement.vendor_blacklist ADD COLUMN IF NOT EXISTS blacklisted_until DATE;
ALTER TABLE procurement.vendor_blacklist ADD COLUMN IF NOT EXISTS order_ref TEXT;
ALTER TABLE procurement.vendor_blacklist ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE procurement.vendor_blacklist ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE procurement.vendor_blacklist ADD COLUMN IF NOT EXISTS blacklisted_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE procurement.vendor_blacklist ADD COLUMN IF NOT EXISTS blacklisted_by UUID;
ALTER TABLE procurement.vendor_blacklist ADD COLUMN IF NOT EXISTS reinstated_at TIMESTAMPTZ;
ALTER TABLE procurement.vendor_blacklist ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'active';
-- Backfill bridging columns in whichever direction data exists.
UPDATE procurement.vendor_blacklist SET created_by = blacklisted_by WHERE created_by IS NULL AND blacklisted_by IS NOT NULL;
UPDATE procurement.vendor_blacklist SET blacklisted_by = created_by WHERE blacklisted_by IS NULL AND created_by IS NOT NULL;

-- Partial unique index: at most one ACTIVE blacklist row per (tenant, vendor).
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_blacklist_active
  ON procurement.vendor_blacklist (tenant_id, vendor_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ix_vendor_blacklist_lookup
  ON procurement.vendor_blacklist (tenant_id, vendor_id, status);

-- ── Three-way-match: align enum + helpful index ────────────────────────────────
-- Existing CHECK already allows ('pending','matched','mismatch','exception').
-- Add a deterministic uniqueness so we don't accumulate duplicate matches per (po,grn).
CREATE UNIQUE INDEX IF NOT EXISTS uq_three_way_match_po_grn
  ON procurement.three_way_match (tenant_id, po_id, grn_id);

CREATE INDEX IF NOT EXISTS ix_three_way_match_po
  ON procurement.three_way_match (tenant_id, po_id, match_status);

-- ── Gapless per-tenant document numbering (atomic counter / voucher allocator) ─
CREATE TABLE IF NOT EXISTS procurement.doc_counters (
  tenant_id UUID NOT NULL,
  doc_type  VARCHAR(24) NOT NULL,
  period    VARCHAR(8)  NOT NULL,            -- e.g. fiscal-year bucket '2026'
  last_seq  BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, doc_type, period)
);
