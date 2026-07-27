-- 0014_three_way_matches.sql
--
-- Purpose: create `inventory.three_way_matches`, which the Drizzle model has
-- declared since the matching module was written but which no migration ever
-- created.
--
-- DEFECT THIS FIXES (P0, live)
-- `src/modules/matching/schema.ts` declares 26 columns on
-- inventory.three_way_matches; `queries.ts` selects from it and `consumer.ts`
-- inserts into it. The table does not exist, so every request to the matching
-- module was a 500 against the running fleet:
--
--   GET  http://localhost:3025/v1/inventory/matches      -> 500 {"code":"INTERNAL"}
--   GET  http://localhost:8080/api/v1/inventory/matches  -> 500 UPSTREAM_ERROR
--
-- Reachable through the gateway, and it is a money path: three-way match is the
-- PO x GRN x Invoice control that gates payment authorisation (GFR 2017). With
-- the table absent, `payment_blocked` could never be recorded, so the control
-- was not merely broken — it was absent.
--
-- Found by scripts/ci/schema-drift-guard.mjs (all 26 columns reported missing).
--
-- Column types are taken directly from the Drizzle model, not inferred:
--   bigint(mode:"bigint")           -> bigint      (money in paise, per platform rule)
--   integer                        -> integer     (quantities, tolerance_pct, version)
--   varchar(status,{length:32})    -> varchar(32)
--   timestamp({withTimezone:true}) -> timestamptz
--   jsonb / text / uuid            -> as declared
-- `payment_blocked` is `integer` in the model (0/1), not boolean; kept as integer
-- so the model and the table agree. Changing it to boolean would reintroduce
-- drift in the opposite direction.
--
-- Rollback:
--   DROP TABLE IF EXISTS inventory.three_way_matches;
--   (Safe: the table is new and holds no data prior to this migration.)
--
-- Affected services: inventory-service (matching module)
-- Additive and idempotent.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS inventory.three_way_matches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  po_id               uuid        NOT NULL,
  po_line_id          uuid,
  grn_id              uuid        NOT NULL,
  invoice_id          uuid        NOT NULL,
  po_qty              integer     NOT NULL,
  po_rate_paise       bigint      NOT NULL,
  grn_qty             integer     NOT NULL,
  invoice_qty         integer     NOT NULL,
  invoice_rate_paise  bigint      NOT NULL,
  status              varchar(32) NOT NULL DEFAULT 'pending',
  payment_blocked     integer     NOT NULL DEFAULT 0,
  tolerance_pct       integer     NOT NULL DEFAULT 5,
  tolerance_abs_paise bigint,
  qty_variances       jsonb,
  rate_variances      jsonb,
  summary             text,
  resolved_by         uuid,
  resolved_at         timestamptz,
  resolution_note     text,
  created_by          uuid        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid        NOT NULL,
  version             integer     NOT NULL DEFAULT 1
);

-- Status domain: enumerated from the code that actually writes the column, not
-- guessed. `MatchStatus` in domain.ts is "matched" | "mismatch" | "exception"
-- (consumer.ts:58 writes result.status); consumer.ts:87 writes "resolved" on
-- resolve; and the Drizzle model defaults the column to "pending". Any other
-- value would be rejected — a CHECK built from plausible-sounding names instead
-- of the real ones would have made every insert fail.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'three_way_matches_status_check'
       AND conrelid = 'inventory.three_way_matches'::regclass
  ) THEN
    ALTER TABLE inventory.three_way_matches
      ADD CONSTRAINT three_way_matches_status_check
      CHECK (status IN ('pending', 'matched', 'mismatch', 'exception', 'resolved'));
  END IF;
END
$$;

-- One match record per (PO line, GRN, invoice) per tenant. A database-level
-- UNIQUE, not just an application check, per the platform concurrency rule.
-- po_line_id is nullable, so COALESCE gives header-level matches a stable key.
CREATE UNIQUE INDEX IF NOT EXISTS three_way_matches_business_key_idx
  ON inventory.three_way_matches
     (tenant_id, po_id, COALESCE(po_line_id, '00000000-0000-0000-0000-000000000000'::uuid), grn_id, invoice_id);

-- Indexes for the filters exposed by queries.ts (poId, grnId, invoiceId, status).
CREATE INDEX IF NOT EXISTS three_way_matches_tenant_idx   ON inventory.three_way_matches (tenant_id);
CREATE INDEX IF NOT EXISTS three_way_matches_po_idx       ON inventory.three_way_matches (tenant_id, po_id);
CREATE INDEX IF NOT EXISTS three_way_matches_grn_idx      ON inventory.three_way_matches (tenant_id, grn_id);
CREATE INDEX IF NOT EXISTS three_way_matches_invoice_idx  ON inventory.three_way_matches (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS three_way_matches_status_idx   ON inventory.three_way_matches (tenant_id, status);

-- Tenant isolation, identical to 0004_rls_full_tenant_isolation.sql. A new
-- tenant-scoped table without RLS would be a silent isolation hole.
ALTER TABLE inventory.three_way_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.three_way_matches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON inventory.three_way_matches;
CREATE POLICY tenant_isolation_policy ON inventory.three_way_matches
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

COMMENT ON TABLE inventory.three_way_matches IS
  'PO x GRN x Invoice verification outcomes. Gates payment authorisation via payment_blocked. Money in bigint paise.';
