-- Migration: 0050_reconciliation_break_dedup.sql
-- Purpose: CAP-059 — make reconciliation idempotent. runReconciliation() blind-
--          inserted a break for every engine finding, so re-running for the same
--          provider while a mismatch persists piled up duplicate OPEN breaks for
--          the same discrepancy. Guard it at the DB with a partial unique index so
--          at most one ACTIVE (open/investigating) break can exist per identity,
--          and let the writer ON CONFLICT DO NOTHING.
--
--          Break identity is (tenant, provider, break_key, break_type, field): a
--          single key legitimately yields several distinct breaks (one per
--          mismatching field, plus missing/duplicate), so break_key alone is too
--          coarse and would collapse genuinely-different breaks. `provider` lives
--          on recon_run, so it is denormalised onto recon_break here to make it a
--          usable ON CONFLICT arbiter column.
-- Rollback: DROP INDEX IF EXISTS recon.recon_break_active_ident_key;
--           ALTER TABLE recon.recon_break DROP COLUMN IF EXISTS provider;
-- Affected services: finance-service (recon module). Additive + idempotent.

SET lock_timeout = '5s';

-- 1) Denormalise the run's provider onto the break so it can be part of the
--    dedup key / ON CONFLICT arbiter.
ALTER TABLE recon.recon_break ADD COLUMN IF NOT EXISTS provider varchar(64);

-- 2) Backfill provider from the owning run for any pre-existing rows.
UPDATE recon.recon_break b
   SET provider = r.provider
  FROM recon.recon_run r
 WHERE b.run_id = r.id
   AND b.provider IS NULL;

-- 3) Collapse any pre-existing duplicate ACTIVE breaks (from the pre-fix blind
--    insert) so the unique index can build. Keep the earliest row per identity.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, provider, break_key, break_type, COALESCE(field, '')
           ORDER BY created_at, id
         ) AS rn
    FROM recon.recon_break
   WHERE status IN ('open', 'investigating')
)
DELETE FROM recon.recon_break b
 USING ranked
 WHERE b.id = ranked.id
   AND ranked.rn > 1;

-- 4) One ACTIVE break per (tenant, provider, break_key, break_type, field).
--    NULLS NOT DISTINCT (PG15+) so break_type rows with a NULL field (missing_in_*,
--    duplicate_key) still dedupe. Partial: resolved/discarded breaks are exempt,
--    so a discrepancy that recurs after resolution can raise a fresh break.
CREATE UNIQUE INDEX IF NOT EXISTS recon_break_active_ident_key
  ON recon.recon_break (tenant_id, provider, break_key, break_type, field)
  NULLS NOT DISTINCT
  WHERE status IN ('open', 'investigating');
