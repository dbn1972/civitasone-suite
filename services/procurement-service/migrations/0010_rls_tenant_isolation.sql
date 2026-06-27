-- procurement-service RLS migration: tenant isolation backstop
-- Role: procurement_svc on civitas_procurement
-- Applied AFTER 0009_tender_sod_sanction.sql
-- Additive only — no DROP TABLE, no ALTER COLUMN, no data changes.
-- Idempotent: uses DROP POLICY IF EXISTS + CREATE OR REPLACE.

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════════
-- Helper function: reads app.tenant_id from session variable (SET LOCAL by middleware)
-- Anchored in the `indent` schema; all policies reference this single function.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION indent.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- ── indent schema ─────────────────────────────────────────────────────────────
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE indent.procurement_indents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE indent.procurement_indent_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE indent.procurement_indents       FORCE ROW LEVEL SECURITY;
ALTER TABLE indent.procurement_indent_items  FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON indent.procurement_indents;
DROP POLICY IF EXISTS tenant_isolation ON indent.procurement_indent_items;

CREATE POLICY tenant_isolation ON indent.procurement_indents
  USING (tenant_id = indent.current_tenant_id());
CREATE POLICY tenant_isolation ON indent.procurement_indent_items
  USING (tenant_id = indent.current_tenant_id());

-- ══════════════════════════════════════════════════════════════════════════════
-- ── vendor schema ─────────────────────────────────────────────────────────────
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE vendor.procurement_vendors       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.procurement_vendor_docs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.procurement_empanelment   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.procurement_vendors       FORCE ROW LEVEL SECURITY;
ALTER TABLE vendor.procurement_vendor_docs   FORCE ROW LEVEL SECURITY;
ALTER TABLE vendor.procurement_empanelment   FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON vendor.procurement_vendors;
DROP POLICY IF EXISTS tenant_isolation ON vendor.procurement_vendor_docs;
DROP POLICY IF EXISTS tenant_isolation ON vendor.procurement_empanelment;

CREATE POLICY tenant_isolation ON vendor.procurement_vendors
  USING (tenant_id = indent.current_tenant_id());
CREATE POLICY tenant_isolation ON vendor.procurement_vendor_docs
  USING (tenant_id = indent.current_tenant_id());
CREATE POLICY tenant_isolation ON vendor.procurement_empanelment
  USING (tenant_id = indent.current_tenant_id());

-- ══════════════════════════════════════════════════════════════════════════════
-- ── po schema ─────────────────────────────────────────────────────────────────
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE po.procurement_pos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE po.procurement_po_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE po.procurement_pos               FORCE ROW LEVEL SECURITY;
ALTER TABLE po.procurement_po_items          FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON po.procurement_pos;
DROP POLICY IF EXISTS tenant_isolation ON po.procurement_po_items;

CREATE POLICY tenant_isolation ON po.procurement_pos
  USING (tenant_id = indent.current_tenant_id());
CREATE POLICY tenant_isolation ON po.procurement_po_items
  USING (tenant_id = indent.current_tenant_id());

-- ══════════════════════════════════════════════════════════════════════════════
-- ── grn schema ────────────────────────────────────────────────────────────────
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE grn.procurement_grns             ENABLE ROW LEVEL SECURITY;
ALTER TABLE grn.procurement_grn_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE grn.procurement_inspections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE grn.procurement_grns             FORCE ROW LEVEL SECURITY;
ALTER TABLE grn.procurement_grn_items        FORCE ROW LEVEL SECURITY;
ALTER TABLE grn.procurement_inspections      FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON grn.procurement_grns;
DROP POLICY IF EXISTS tenant_isolation ON grn.procurement_grn_items;
DROP POLICY IF EXISTS tenant_isolation ON grn.procurement_inspections;

CREATE POLICY tenant_isolation ON grn.procurement_grns
  USING (tenant_id = indent.current_tenant_id());
CREATE POLICY tenant_isolation ON grn.procurement_grn_items
  USING (tenant_id = indent.current_tenant_id());
CREATE POLICY tenant_isolation ON grn.procurement_inspections
  USING (tenant_id = indent.current_tenant_id());

-- ══════════════════════════════════════════════════════════════════════════════
-- ── rfq schema ────────────────────────────────────────────────────────────────
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE rfq.procurement_rfqs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq.procurement_rfq_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq.procurement_rfqs             FORCE ROW LEVEL SECURITY;
ALTER TABLE rfq.procurement_rfq_items        FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON rfq.procurement_rfqs;
DROP POLICY IF EXISTS tenant_isolation ON rfq.procurement_rfq_items;

CREATE POLICY tenant_isolation ON rfq.procurement_rfqs
  USING (tenant_id = indent.current_tenant_id());
CREATE POLICY tenant_isolation ON rfq.procurement_rfq_items
  USING (tenant_id = indent.current_tenant_id());

-- ══════════════════════════════════════════════════════════════════════════════
-- ── tender schema ─────────────────────────────────────────────────────────────
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE tender.procurement_tenders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender.procurement_tender_bids          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender.procurement_tender_financial_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender.procurement_tenders              FORCE ROW LEVEL SECURITY;
ALTER TABLE tender.procurement_tender_bids          FORCE ROW LEVEL SECURITY;
ALTER TABLE tender.procurement_tender_financial_bids FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tender.procurement_tenders;
DROP POLICY IF EXISTS tenant_isolation ON tender.procurement_tender_bids;
DROP POLICY IF EXISTS tenant_isolation ON tender.procurement_tender_financial_bids;

CREATE POLICY tenant_isolation ON tender.procurement_tenders
  USING (tenant_id = indent.current_tenant_id());
CREATE POLICY tenant_isolation ON tender.procurement_tender_bids
  USING (tenant_id = indent.current_tenant_id());
CREATE POLICY tenant_isolation ON tender.procurement_tender_financial_bids
  USING (tenant_id = indent.current_tenant_id());

-- ══════════════════════════════════════════════════════════════════════════════
-- ── auction schema ────────────────────────────────────────────────────────────
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE auction.procurement_auctions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.procurement_bids         ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.procurement_auctions     FORCE ROW LEVEL SECURITY;
ALTER TABLE auction.procurement_bids         FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON auction.procurement_auctions;
DROP POLICY IF EXISTS tenant_isolation ON auction.procurement_bids;

CREATE POLICY tenant_isolation ON auction.procurement_auctions
  USING (tenant_id = indent.current_tenant_id());
CREATE POLICY tenant_isolation ON auction.procurement_bids
  USING (tenant_id = indent.current_tenant_id());

-- ══════════════════════════════════════════════════════════════════════════════
-- ── payments schema ───────────────────────────────────────────────────────────
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE payments.procurement_advances    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.procurement_debit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.procurement_advances    FORCE ROW LEVEL SECURITY;
ALTER TABLE payments.procurement_debit_notes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON payments.procurement_advances;
DROP POLICY IF EXISTS tenant_isolation ON payments.procurement_debit_notes;

CREATE POLICY tenant_isolation ON payments.procurement_advances
  USING (tenant_id = indent.current_tenant_id());
CREATE POLICY tenant_isolation ON payments.procurement_debit_notes
  USING (tenant_id = indent.current_tenant_id());

-- ══════════════════════════════════════════════════════════════════════════════
-- ── security schema (EMD + PBG) ───────────────────────────────────────────────
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE security.procurement_emd         ENABLE ROW LEVEL SECURITY;
ALTER TABLE security.procurement_pbg         ENABLE ROW LEVEL SECURITY;
ALTER TABLE security.procurement_emd         FORCE ROW LEVEL SECURITY;
ALTER TABLE security.procurement_pbg         FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON security.procurement_emd;
DROP POLICY IF EXISTS tenant_isolation ON security.procurement_pbg;

CREATE POLICY tenant_isolation ON security.procurement_emd
  USING (tenant_id = indent.current_tenant_id());
CREATE POLICY tenant_isolation ON security.procurement_pbg
  USING (tenant_id = indent.current_tenant_id());

-- ══════════════════════════════════════════════════════════════════════════════
-- ── procurement schema (cross-cutting) ────────────────────────────────────────
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE procurement.three_way_match      ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.vendor_blacklist     ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.doc_counters         ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.three_way_match      FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement.vendor_blacklist     FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement.doc_counters         FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON procurement.three_way_match;
DROP POLICY IF EXISTS tenant_isolation ON procurement.vendor_blacklist;
DROP POLICY IF EXISTS tenant_isolation ON procurement.doc_counters;

CREATE POLICY tenant_isolation ON procurement.three_way_match
  USING (tenant_id = indent.current_tenant_id());
CREATE POLICY tenant_isolation ON procurement.vendor_blacklist
  USING (tenant_id = indent.current_tenant_id());
CREATE POLICY tenant_isolation ON procurement.doc_counters
  USING (tenant_id = indent.current_tenant_id());

-- ══════════════════════════════════════════════════════════════════════════════
-- ── _outbox schema ────────────────────────────────────────────────────────────
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE _outbox.messages                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages                 FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;

CREATE POLICY tenant_isolation ON _outbox.messages
  USING (tenant_id = indent.current_tenant_id());

COMMIT;
