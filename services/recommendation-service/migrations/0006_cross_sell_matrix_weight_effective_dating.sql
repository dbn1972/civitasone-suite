-- Purpose: XS-001 — per-cell weighting and effective dating on the cross-sell matrix.
--          Adds weight_bps (integer basis points, 0..10000) so a cell can carry a
--          relative strength independent of `priority`, plus effective_from /
--          effective_to so a cell can be scheduled and retired without deleting the
--          configuration history. Matches src/modules/matrix/schema.ts.
-- Rollback: ALTER TABLE recommendation.cross_sell_matrix
--             DROP CONSTRAINT IF EXISTS ck_cross_sell_matrix_weight_bps_range,
--             DROP CONSTRAINT IF EXISTS ck_cross_sell_matrix_effective_window,
--             DROP COLUMN IF EXISTS weight_bps,
--             DROP COLUMN IF EXISTS effective_from,
--             DROP COLUMN IF EXISTS effective_to;
--           DROP INDEX CONCURRENTLY IF EXISTS
--             recommendation.idx_cross_sell_matrix_tenant_trigger_rank;
--           (column drops are destructive — require explicit approval)
-- Affected services: recommendation-service only. No other service reads this table
--                    (cross-service access is via /v1/recommendations HTTP reads).
SET lock_timeout = '5s';

-- ── Columns ──────────────────────────────────────────────────────────────────
--
-- weight_bps is NOT NULL DEFAULT 0 even though the "no NOT NULL on existing
-- columns" rule exists: that rule is about *promoting an existing nullable
-- column*. Adding a NEW column with a non-volatile default is a catalogue-only
-- change on PostgreSQL 11+ (fast default) — no table rewrite, no backfill pass.
-- The default of 0 is the neutral value: `resolveCompanions` orders by priority
-- first and only uses weight_bps as a tie-break, so pre-XS-001 rows keep their
-- existing relative order.
--
-- BASIS POINTS, not a float and not bigint minor units: the value is a ratio
-- (10000 = 100%), so an int round-trips exactly through JSON as a number and
-- needs none of the string-on-the-wire handling that money columns require.
ALTER TABLE recommendation.cross_sell_matrix
  ADD COLUMN IF NOT EXISTS weight_bps int NOT NULL DEFAULT 0;

-- Nullable on purpose, and NULL is meaningful rather than "unknown":
--   effective_from IS NULL → live since forever
--   effective_to   IS NULL → never expires
-- Every pre-XS-001 row is therefore unconditionally live, which is exactly its
-- behaviour before this migration. The window is half-open [from, to) in both
-- SQL (matrix/repo.ts listEffectiveForTriggers) and the domain
-- (matrix/domain.ts isEffectiveAt) so a cell that ends at T and one that starts
-- at T never overlap.
ALTER TABLE recommendation.cross_sell_matrix
  ADD COLUMN IF NOT EXISTS effective_from timestamptz;

ALTER TABLE recommendation.cross_sell_matrix
  ADD COLUMN IF NOT EXISTS effective_to timestamptz;

-- ── Constraints ──────────────────────────────────────────────────────────────
--
-- Defence in depth behind the route validators (zod + validateWeightBps +
-- validateEffectiveWindow return 422 before any write). These CHECKs exist
-- because both rules are *definitional* — 0..10000 is what "basis points"
-- means, and a window that ends before it starts can never match — so unlike
-- the reason_code set in 0004 they can never need loosening for a future
-- feature. A firing CHECK means an app-layer bug, and failing the write is
-- better than persisting a cell that can never be served.
--
-- Added NOT VALID then VALIDATEd separately: ADD CONSTRAINT ... NOT VALID takes
-- a brief ACCESS EXCLUSIVE lock without scanning, and VALIDATE CONSTRAINT then
-- scans under SHARE UPDATE EXCLUSIVE, which does not block reads or writes.
-- Wrapped in DO blocks because ADD CONSTRAINT has no IF NOT EXISTS.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'recommendation.cross_sell_matrix'::regclass
      AND conname = 'ck_cross_sell_matrix_weight_bps_range'
  ) THEN
    ALTER TABLE recommendation.cross_sell_matrix
      ADD CONSTRAINT ck_cross_sell_matrix_weight_bps_range
      CHECK (weight_bps >= 0 AND weight_bps <= 10000) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'recommendation.cross_sell_matrix'::regclass
      AND conname = 'ck_cross_sell_matrix_effective_window'
  ) THEN
    ALTER TABLE recommendation.cross_sell_matrix
      ADD CONSTRAINT ck_cross_sell_matrix_effective_window
      -- Half-open window: strict >, so a zero-length window is refused.
      CHECK (
        effective_from IS NULL
        OR effective_to IS NULL
        OR effective_to > effective_from
      ) NOT VALID;
  END IF;
END $$;

-- Safe to validate immediately: every pre-existing row has weight_bps = 0 (the
-- fast default just applied) and both window bounds NULL, so neither CHECK can
-- fail. VALIDATE is idempotent — a no-op once convalidated is true.
ALTER TABLE recommendation.cross_sell_matrix
  VALIDATE CONSTRAINT ck_cross_sell_matrix_weight_bps_range;

ALTER TABLE recommendation.cross_sell_matrix
  VALIDATE CONSTRAINT ck_cross_sell_matrix_effective_window;

-- ── Index ────────────────────────────────────────────────────────────────────
--
-- Serves matrix/repo.ts listEffectiveForTriggers: equality on
-- (tenant_id, trigger_product_id IN (...)) then ORDER BY priority DESC,
-- weight_bps DESC, id ASC with a LIMIT. Leading the index with the two equality
-- columns and continuing in the sort order lets the planner satisfy the ORDER BY
-- from the index and stop at the limit, instead of sorting every cell for a
-- customer's whole product holding. The effective-date predicates stay as
-- residual filters — they are inequalities over mostly-NULL columns, so putting
-- them in the index would not narrow the scan but would defeat the ordered read.
--
-- id is included as the final tie-break so the ordering the domain relies on is
-- total and reproducible (an unordered tail would make companion ranking
-- non-deterministic between reads).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_sell_matrix_tenant_trigger_rank
  ON recommendation.cross_sell_matrix
  (tenant_id, trigger_product_id, priority DESC, weight_bps DESC, id);

-- Existing RLS policy (cross_sell_matrix_tenant_isolation, migration 0001) covers
-- the new columns: RLS is per-row, not per-column, so nothing to re-declare.

-- Column-level privileges are not used on this table, so ADD COLUMN needs no new
-- grant. Re-asserted for consistency with 0004 and to stay correct if the service
-- role is provisioned after this migration runs.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recommendation_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON recommendation.cross_sell_matrix TO recommendation_svc;
  END IF;
END $$;
