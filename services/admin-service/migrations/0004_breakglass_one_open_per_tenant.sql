-- 0004: P0 — at most one OPEN break-glass grant per tenant.
-- Additive + idempotent. The previous index (idx_admin_break_glass_open) was a
-- plain (non-unique) partial index, so a second open with a different ticket_id
-- (a distinct idempotency key, which markProcessed does NOT dedupe) could create
-- two concurrent open grants for the same tenant. Replace it with a partial
-- UNIQUE index so a racing/second open collides at the DB instead.
--
-- Safe to re-run: both statements are guarded. If duplicate open grants already
-- existed the CREATE UNIQUE would fail; verified clean before shipping.

CREATE UNIQUE INDEX IF NOT EXISTS admin_break_glass_one_open_per_tenant
  ON support.admin_break_glass_log (tenant_id)
  WHERE closed_at IS NULL;

-- The old non-unique index is now redundant (the unique one serves the same
-- "find open grant by tenant" lookups). Drop it to avoid a duplicate index.
DROP INDEX IF EXISTS support.idx_admin_break_glass_open;
