-- 0009_tender_sod_sanction.sql
-- Wave 3 security remediation for the tender lifecycle. Additive + idempotent.
--   C1  — Segregation of duties across create / technical-eval / award:
--          persist the actor on each stage so the award consumer can reject
--          self-award (award approver == creator) and approver == tech evaluator.
--   C2  — Carry a tender-level sanction_ref so award->PO can thread it into the
--          poCreate payload; high-value tenders without it fail the award in-txn.
--   H3  — Enforce one sealed bid per (tenant, tender, vendor).
-- NOTE: schema "tender" is owned by civitas_admin; the tender.* statements below
-- are applied as civitas_admin (schema owner). Idempotent; safe to re-run.

-- ── C1: per-stage actors ───────────────────────────────────────────────────────
-- created_by already exists (set at tenderCreate). Add the technical-evaluation
-- and award actors so SoD can be enforced against the persisted lineage.
ALTER TABLE tender.procurement_tenders ADD COLUMN IF NOT EXISTS tech_evaluated_by UUID;
ALTER TABLE tender.procurement_tenders ADD COLUMN IF NOT EXISTS awarded_by UUID;

-- ── C2: tender-level sanction reference ────────────────────────────────────────
ALTER TABLE tender.procurement_tenders ADD COLUMN IF NOT EXISTS sanction_ref TEXT;

-- ── H3: one bid per vendor per tender ──────────────────────────────────────────
-- (No existing duplicates verified before applying.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tender_bids_tenant_tender_vendor
  ON tender.procurement_tender_bids (tenant_id, tender_id, vendor_id);
