-- CRITICAL FIX: period-close has never actually worked. gl.finance_period_close
-- was first created by 0005_world_class.sql WITHOUT a unique constraint.
-- 0006_period_close.sql tried to (re-)declare the same table WITH
-- UNIQUE(tenant_id, fiscal_year, period) using CREATE TABLE IF NOT EXISTS —
-- but since 0005 already ran first and created the table, IF NOT EXISTS
-- silently no-ops the ENTIRE statement, constraint included (confirmed live:
-- a fresh bootstrap logs "relation \"finance_period_close\" already exists,
-- skipping" for 0006, and \d gl.finance_period_close shows only the primary
-- key on id — no unique constraint at all).
--
-- Every close/hard-close command's `INSERT ... ON CONFLICT (tenant_id,
-- fiscal_year, period)` (services/finance-service/src/modules/period-close)
-- therefore fails on every environment that has run migrations in order from
-- scratch — the INSERT throws "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification", the row is never written, and a
-- journal posted into the "closed" period goes through with no rejection
-- (getPeriodStatusTx finds no row -> treats the period as open).
--
-- Fix: add the constraint directly via ALTER TABLE, guarded by an
-- information_schema check for the constraint's actual column set (not by
-- CREATE TABLE IF NOT EXISTS, which is exactly what silently swallowed it
-- the first time). Idempotent and safe to re-run: if some environment
-- already carries an equivalent unique constraint (under any name) on
-- exactly these three columns, this is a no-op; otherwise it adds it.
DO $mig$
DECLARE
  v_has_constraint boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM (
      SELECT tc.constraint_name,
             array_agg(ccu.column_name::text ORDER BY ccu.column_name::text) AS cols
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_schema = tc.constraint_schema
       AND ccu.constraint_name  = tc.constraint_name
      WHERE tc.table_schema = 'gl'
        AND tc.table_name = 'finance_period_close'
        AND tc.constraint_type = 'UNIQUE'
      GROUP BY tc.constraint_name
    ) sub
    WHERE sub.cols = ARRAY['fiscal_year', 'period', 'tenant_id']::text[]
  ) INTO v_has_constraint;

  IF NOT v_has_constraint THEN
    ALTER TABLE gl.finance_period_close
      ADD CONSTRAINT finance_period_close_tenant_fy_period_key
      UNIQUE (tenant_id, fiscal_year, period);
  END IF;
END
$mig$;
