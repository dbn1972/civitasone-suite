-- 0255_hrms_transfers_order_no_dedupe.sql
--
-- UAT F100: ux_hrms_transfers_order_no (0185 part 2) does not exist on live UAT.
-- 0185 refuses to build it while duplicate order numbers exist (by design), and the
-- tolerant deploy runner hid that refusal. The only duplicate group on UAT (SELECT
-- only, 2026-10-31):
--   tenant aaaaaaaa-1111-4000-8000-000000000099, order_no 'TO/2026/001', 112 rows
--   (created 2026-09-05 .. 2026-09-30, 112 distinct employees, all order_date
--   2026-05-01, status ordered 56 / relieved 56).
-- That tenant id is a fixed test-fixture UUID used by many service test suites and is
-- not a registered tenant in civitas_tenant: these are test-run rows.
--
-- This migration:
--   1. De-duplicates THAT test tenant only: within each case-insensitive order_no
--      group, the earliest row (created_at, id) keeps its number and every later row
--      becomes '<order_no>-TESTDUP-<nnn>' (nnn = its position in the group). The
--      suffix itself marks the row as test data: hrms_transfers has no remarks/notes
--      column. Nothing is deleted; no other column changes except updated_at.
--   2. Keeps 0185's loud refusal for any OTHER duplicate group: real data is never
--      renamed by a migration.
--   3. Creates the unique index exactly as 0185 defines it.
--
-- Rows changed on UAT: 111 (112 in the group, the earliest keeps 'TO/2026/001').
-- Fresh / CI databases: 0 rows; the index already exists from 0185, so a no-op.
-- Idempotent: after the first run the group has no duplicates, and the index is
-- IF NOT EXISTS.
--
-- RLS: lifecycle.hrms_transfers is FORCE RLS and the runner applies this as its owner
-- (hrms_svc, NOBYPASSRLS). FORCE is lifted for the UPDATE and restored in the same
-- transaction (house idiom).
--
-- Preview on UAT (SELECT only):
--   SELECT id, order_no, created_at FROM (
--     SELECT *, row_number() OVER (PARTITION BY tenant_id, lower(order_no)
--                                  ORDER BY created_at, id) AS rn
--       FROM lifecycle.hrms_transfers
--      WHERE tenant_id = 'aaaaaaaa-1111-4000-8000-000000000099' AND order_no IS NOT NULL) d
--    WHERE rn > 1;
--
-- Rollback: DROP INDEX IF EXISTS lifecycle.ux_hrms_transfers_order_no; the renamed test
-- rows can be restored with
--   UPDATE lifecycle.hrms_transfers SET order_no = split_part(order_no, '-TESTDUP-', 1)
--    WHERE tenant_id = 'aaaaaaaa-1111-4000-8000-000000000099' AND order_no LIKE '%-TESTDUP-%';

SET lock_timeout = '5s';

BEGIN;

DO $$
DECLARE
  forced boolean;
  n      bigint;
  dups   text;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'lifecycle.hrms_transfers'::regclass;
  IF forced THEN
    ALTER TABLE lifecycle.hrms_transfers NO FORCE ROW LEVEL SECURITY;
  END IF;

  UPDATE lifecycle.hrms_transfers t
     SET order_no   = left(t.order_no, 64 - length('-TESTDUP-' || lpad(d.rn::text, 3, '0')))
                      || '-TESTDUP-' || lpad(d.rn::text, 3, '0'),
         updated_at = now()
    FROM (
      SELECT id,
             row_number() OVER (PARTITION BY tenant_id, lower(order_no) ORDER BY created_at, id) - 1 AS rn
        FROM lifecycle.hrms_transfers
       WHERE tenant_id = 'aaaaaaaa-1111-4000-8000-000000000099'
         AND order_no IS NOT NULL
    ) d
   WHERE t.id = d.id AND d.rn > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0255: suffixed % duplicate test transfer order numbers', n;

  SELECT string_agg(format('(tenant %s, order_no %s, %s rows)', tenant_id, o, c), '; ')
    INTO dups
    FROM (
      SELECT tenant_id, lower(order_no) AS o, count(*) AS c
        FROM lifecycle.hrms_transfers
       WHERE order_no IS NOT NULL
       GROUP BY tenant_id, lower(order_no)
      HAVING count(*) > 1
    ) g;

  IF forced THEN
    ALTER TABLE lifecycle.hrms_transfers FORCE ROW LEVEL SECURITY;
  END IF;

  IF dups IS NOT NULL THEN
    RAISE EXCEPTION 'cannot create ux_hrms_transfers_order_no: duplicate transfer order numbers exist: %', dups;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_hrms_transfers_order_no
  ON lifecycle.hrms_transfers (tenant_id, lower(order_no))
  WHERE order_no IS NOT NULL;

-- IF NOT EXISTS trusts the name. Prove the index is the real one: unique, valid, and on
-- (tenant_id, lower(order_no)) for non-null order numbers.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.oid = to_regclass('lifecycle.ux_hrms_transfers_order_no')
       AND i.indrelid = 'lifecycle.hrms_transfers'::regclass
       AND i.indisunique AND i.indisvalid
       AND pg_get_indexdef(c.oid) LIKE '%(tenant_id, lower((order_no)::text)) WHERE (order_no IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION 'lifecycle.ux_hrms_transfers_order_no exists but is not the unique (tenant_id, lower(order_no)) index: %',
      pg_get_indexdef(to_regclass('lifecycle.ux_hrms_transfers_order_no'));
  END IF;
END $$;

COMMIT;
