-- 0185_hrms_leave_apps_day_part_and_transfer_order_no.sql
--
-- GAP-HR-LEAVE-APPLY-05: ux_leave_apps_active (0028) allowed ONE live
-- application per (tenant, employee, from_date, leave_type). Two half days of
-- the same Casual Leave on one date (first half + second half) are a
-- legitimate pair, so day_part joins the key. Strictly weaker than before for
-- whole days (all existing rows are 'full', so nothing that was unique stops
-- being unique) and still rejects the same part booked twice.
--
-- Idempotent: only rebuilds the index while it still lacks day_part.
-- Rollback: DROP INDEX leave.ux_leave_apps_active; recreate it without day_part (see 0028).
--
-- ALSO (part 2, GAP-HR-TRANSFER-02): unique transfer order numbers, see the end of this file.

SET lock_timeout = '5s';

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'leave' AND indexname = 'ux_leave_apps_active' AND indexdef NOT LIKE '%day_part%'
  ) THEN
    DROP INDEX leave.ux_leave_apps_active;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_leave_apps_active
  ON leave.hrms_leave_apps (tenant_id, employee_id, from_date, leave_type_id, day_part)
  WHERE status NOT IN ('rejected', 'cancelled');

-- ───────────────────────── part 2 ─────────────────────────
-- GAP-HR-TRANSFER-02: a transfer order number is an official identifier copied
-- to the service book, so it must be unique per tenant (case-insensitive).
-- Until now the order number was fabricated client-side as TO-<uuid prefix> and
-- never checked. The unique index is the race-safe backstop for the route's
-- and consumer's own checks.
--
-- Existing data: if any tenant already has two transfers sharing an order
-- number (case-insensitive) this migration FAILS LOUDLY, listing the offending
-- (tenant, order_no) pairs, so the data is corrected before the index exists
-- rather than the guarantee being silently skipped. Idempotent.
--
-- Rollback: DROP INDEX IF EXISTS lifecycle.ux_hrms_transfers_order_no;


DO $$
DECLARE dups text;
BEGIN
  SELECT string_agg(format('(tenant %s, order_no %s, %s rows)', tenant_id, o, n), '; ')
    INTO dups
    FROM (
      SELECT tenant_id, lower(order_no) AS o, count(*) AS n
      FROM lifecycle.hrms_transfers
      WHERE order_no IS NOT NULL
      GROUP BY tenant_id, lower(order_no)
      HAVING count(*) > 1
    ) d;
  IF dups IS NOT NULL THEN
    RAISE EXCEPTION 'cannot create ux_hrms_transfers_order_no: duplicate transfer order numbers exist: %', dups;
  END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_hrms_transfers_order_no
    ON lifecycle.hrms_transfers (tenant_id, lower(order_no))
    WHERE order_no IS NOT NULL;
END $$;
