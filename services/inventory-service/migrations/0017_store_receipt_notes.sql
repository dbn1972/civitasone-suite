-- 0017_store_receipt_notes.sql
--
-- Purpose: create `inventory.store_receipt_notes` — the Store Receipt Note
-- (SRN) that GFR Rule 149 requires to be signed before any payment against a
-- GRN can be authorised (Req 1.1, estab-inv-int-go-live spec). The SRN
-- belongs to the inventory domain (physical acceptance into store), not to
-- procurement, per docs/specs/estab-inv-int-go-live/design.md §1.
--
-- Columns follow the design doc exactly:
--   id, tenant_id, grn_id, store_officer_id, received_at, remarks, status,
--   created_at.
--
-- grn_id references `grn.procurement_grns(id)` conceptually, but
-- inventory-service and procurement-service are separate physical databases
-- (civitas_inventory vs civitas_procurement — see docs/DATABASE-SCHEMA.md §6,
-- "there are no cross-database foreign keys"). A literal
-- `REFERENCES grn.procurement_grns(id)` would fail at apply time since that
-- table lives in a different database. This mirrors the existing precedent in
-- this same service: `inventory.three_way_matches.grn_id` (migration 0014) is
-- also a plain `uuid NOT NULL` with no FK for the same reason. Referential
-- integrity across services is eventual, via events, per platform convention.
--
-- Rollback:
--   DROP TABLE IF EXISTS inventory.store_receipt_notes;
--   (Safe: the table is new and holds no data prior to this migration.)
--
-- Affected services: inventory-service (new `srn` module, task 2+)
-- Requirements: 1.1
-- Additive and idempotent.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS inventory.store_receipt_notes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  grn_id           uuid        NOT NULL,
  store_officer_id uuid        NOT NULL,
  received_at      timestamptz,
  remarks          text,
  status           text        NOT NULL DEFAULT 'draft',
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Status domain per design.md: 'draft' (created, not yet signed) | 'signed'
-- (store officer has signed off — this is what gates payment release).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'store_receipt_notes_status_check'
       AND conrelid = 'inventory.store_receipt_notes'::regclass
  ) THEN
    ALTER TABLE inventory.store_receipt_notes
      ADD CONSTRAINT store_receipt_notes_status_check
      CHECK (status IN ('draft', 'signed'));
  END IF;
END
$$;

-- One SRN per GRN per tenant (repo.findByGrnId assumes at most one row).
CREATE UNIQUE INDEX IF NOT EXISTS store_receipt_notes_grn_idx
  ON inventory.store_receipt_notes (tenant_id, grn_id);

CREATE INDEX IF NOT EXISTS store_receipt_notes_tenant_idx
  ON inventory.store_receipt_notes (tenant_id);

-- Tenant isolation, identical pattern to 0004_rls_full_tenant_isolation.sql /
-- 0014_three_way_matches.sql. A new tenant-scoped table without RLS would be
-- a silent isolation hole.
ALTER TABLE inventory.store_receipt_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.store_receipt_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON inventory.store_receipt_notes;
CREATE POLICY tenant_isolation_policy ON inventory.store_receipt_notes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

COMMENT ON TABLE inventory.store_receipt_notes IS
  'Store Receipt Note (SRN) — GFR Rule 149 signed acceptance of a GRN into store. Gates payment release via the three-way-match consumer.';
