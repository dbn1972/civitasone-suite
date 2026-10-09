-- 0049: Prevent overlapping effective-dated licence-fee rates for the same
-- (tenant_id, quarter_type, pay_level).
--
-- GAP2-ESTAB-QUARTERS-LICENCE-FEE-01: the rate table is effective-dated but had
-- no constraint, so a tenant could hold several rows matching one
-- type+pay-level with overlapping [effective_from, effective_to] ranges. The
-- occupy/vacate consumers now pick the row applicable on the business date via
-- findApplicableRate(); this constraint additionally guarantees at most ONE
-- applicable row for any given date, so the selection is unambiguous.
--
-- Uses a GiST exclusion constraint over a daterange built from
-- [effective_from, COALESCE(effective_to, 'infinity')]. effective_to is treated
-- as an INCLUSIVE last-day, so the half-open range upper bound is the day after.
--
-- EXISTING OVERLAPS ARE RESOLVED FIRST (adding the constraint would otherwise
-- abort the migration for any tenant that already holds overlapping rates):
--   1. Rates sharing the same (tenant, type, pay level, effective_from) cannot
--      both be kept and cannot be "closed the day before" each other. The
--      latest-created one wins; the others are MOVED (not lost) to
--      quarters.estab_licence_fee_rates_superseded for audit/recovery.
--   2. For the remaining rates, each earlier rate whose range reaches the
--      start of the next one is closed the day before that next rate starts
--      (effective_to = next.effective_from - 1 day).
-- The table is FORCE RLS and this migration has no tenant GUC, so the DML runs
-- between NO FORCE / FORCE (the owning role is otherwise subject to its own
-- policies and the UPDATE/DELETE would silently match zero rows).
--
-- Additive + idempotent (catalog check guards the constraint; IF NOT EXISTS on
-- the index; the resolution steps are no-ops once no overlap remains). Requires btree_gist for equality on the uuid/varchar columns.
--
-- Rollback:
--   ALTER TABLE quarters.estab_licence_fee_rates
--     DROP CONSTRAINT IF EXISTS excl_licence_fee_no_overlap;
--   DROP INDEX IF EXISTS quarters.idx_licence_fee_daterange;
--   (closed effective_to dates are not auto-reverted; archived rows stay in
--    quarters.estab_licence_fee_rates_superseded and can be re-inserted by hand.)

SET lock_timeout = '5s';

-- One transaction: if anything below fails, the NO FORCE/FORCE toggle and the
-- data fix roll back together (FORCE can never be left off).
BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Archive for rates removed because an identical start date made them
-- unresolvable. Same shape as the live table plus provenance columns.
CREATE TABLE IF NOT EXISTS quarters.estab_licence_fee_rates_superseded (
  LIKE quarters.estab_licence_fee_rates INCLUDING DEFAULTS,
  superseded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_reason TEXT NOT NULL
);
ALTER TABLE quarters.estab_licence_fee_rates_superseded ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rls_licence_fee_superseded_tenant'
                 AND tablename = 'estab_licence_fee_rates_superseded') THEN
    EXECUTE 'CREATE POLICY rls_licence_fee_superseded_tenant ON quarters.estab_licence_fee_rates_superseded
             USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)';
  END IF;
END $$;
-- ── Resolve pre-existing overlaps (DML under NO FORCE / FORCE) ───────────────
ALTER TABLE quarters.estab_licence_fee_rates NO FORCE ROW LEVEL SECURITY;

-- (1) same effective_from: keep the latest-created, archive the rest.
WITH ranked AS (
  SELECT id, row_number() OVER (
           PARTITION BY tenant_id, quarter_type, pay_level, effective_from
           ORDER BY created_at DESC, id DESC) AS rn
    FROM quarters.estab_licence_fee_rates
), moved AS (
  INSERT INTO quarters.estab_licence_fee_rates_superseded
    SELECT r.*, NOW(), 'same effective_from as a later-created rate (migration 0049 overlap resolution)'
      FROM quarters.estab_licence_fee_rates r
      JOIN ranked k ON k.id = r.id AND k.rn > 1
  RETURNING id
)
DELETE FROM quarters.estab_licence_fee_rates
 WHERE id IN (SELECT id FROM moved);

-- (2) close each earlier rate the day before the next one starts.
UPDATE quarters.estab_licence_fee_rates r
   SET effective_to = s.nxt - 1
  FROM (
    SELECT id,
           lead(effective_from) OVER (
             PARTITION BY tenant_id, quarter_type, pay_level
             ORDER BY effective_from) AS nxt
      FROM quarters.estab_licence_fee_rates
  ) s
 WHERE r.id = s.id
   AND s.nxt IS NOT NULL
   AND (r.effective_to IS NULL OR r.effective_to >= s.nxt);

ALTER TABLE quarters.estab_licence_fee_rates FORCE ROW LEVEL SECURITY;
ALTER TABLE quarters.estab_licence_fee_rates_superseded FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'excl_licence_fee_no_overlap'
      AND conrelid = 'quarters.estab_licence_fee_rates'::regclass
  ) THEN
    ALTER TABLE quarters.estab_licence_fee_rates
      ADD CONSTRAINT excl_licence_fee_no_overlap
      EXCLUDE USING gist (
        tenant_id WITH =,
        quarter_type WITH =,
        pay_level WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
      );
  END IF;
END $$;

-- Supporting GiST index for the daterange lookups the exclusion relies on.
CREATE INDEX IF NOT EXISTS idx_licence_fee_daterange
  ON quarters.estab_licence_fee_rates
  USING gist (tenant_id, quarter_type, pay_level,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]'));

COMMIT;
