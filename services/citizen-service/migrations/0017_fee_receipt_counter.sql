-- citizen-service migration 0017 — atomic offline-receipt sequence counter.
-- Additive only. Mirrors issuance.counters (0015): a gapless per (tenant, year)
-- sequence reserved via INSERT..ON CONFLICT DO UPDATE..RETURNING, replacing the
-- racy SELECT count(*)+1 receipt allocation that could allot duplicate receipt
-- numbers (and 500 on the uq_payments_receipt_no unique index) under concurrency.
-- The fee schema already exists from 0015. RLS + ownership mirror 0015/0016
-- (portal.current_tenant_id()). Idempotent (IF NOT EXISTS) per migrate-all.mjs.

CREATE TABLE IF NOT EXISTS fee.receipt_counters (
  tenant_id   uuid NOT NULL,
  year        integer NOT NULL,
  last_seq    integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, year)
);

-- Backfill: seed each (tenant, year) counter to the highest receipt sequence
-- already issued, so the atomic counter continues PAST existing receipt numbers
-- instead of restarting at 1 and colliding with uq_payments_receipt_no. Receipt
-- numbers are 'RCT-{YYYY}-{seq}'. Idempotent (GREATEST on conflict).
INSERT INTO fee.receipt_counters (tenant_id, year, last_seq)
  SELECT tenant_id,
         (split_part(receipt_no, '-', 2))::int AS year,
         MAX((split_part(receipt_no, '-', 3))::int) AS last_seq
    FROM fee.payments
   WHERE receipt_no IS NOT NULL
     AND receipt_no ~ '^RCT-[0-9]{4}-[0-9]+$'
   GROUP BY tenant_id, (split_part(receipt_no, '-', 2))::int
ON CONFLICT (tenant_id, year)
  DO UPDATE SET last_seq = GREATEST(fee.receipt_counters.last_seq, EXCLUDED.last_seq),
                updated_at = now();

-- ============================================================================
-- Row Level Security — mirror 0007/0015 (portal.current_tenant_id()).
-- ============================================================================
ALTER TABLE fee.receipt_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee.receipt_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fee.receipt_counters;
CREATE POLICY tenant_isolation ON fee.receipt_counters
  USING (tenant_id = portal.current_tenant_id());

-- ============================================================================
-- Ownership → citizen_svc (idempotent; harmless when already owned).
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citizen_svc') THEN
    EXECUTE 'ALTER TABLE fee.receipt_counters OWNER TO citizen_svc';
  END IF;
END $$;
