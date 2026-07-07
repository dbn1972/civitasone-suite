-- RLS completion: full tenant isolation (USING + WITH CHECK) for procurement-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION indent.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- auction.procurement_auctions
ALTER TABLE auction.procurement_auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.procurement_auctions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON auction.procurement_auctions;
DROP POLICY IF EXISTS tenant_isolation ON auction.procurement_auctions;
CREATE POLICY tenant_isolation_policy ON auction.procurement_auctions
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- auction.procurement_bids
ALTER TABLE auction.procurement_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.procurement_bids FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON auction.procurement_bids;
DROP POLICY IF EXISTS tenant_isolation ON auction.procurement_bids;
CREATE POLICY tenant_isolation_policy ON auction.procurement_bids
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- grn.procurement_grn_items
ALTER TABLE grn.procurement_grn_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE grn.procurement_grn_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON grn.procurement_grn_items;
DROP POLICY IF EXISTS tenant_isolation ON grn.procurement_grn_items;
CREATE POLICY tenant_isolation_policy ON grn.procurement_grn_items
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- grn.procurement_grns
ALTER TABLE grn.procurement_grns ENABLE ROW LEVEL SECURITY;
ALTER TABLE grn.procurement_grns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON grn.procurement_grns;
DROP POLICY IF EXISTS tenant_isolation ON grn.procurement_grns;
CREATE POLICY tenant_isolation_policy ON grn.procurement_grns
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- grn.procurement_inspections
ALTER TABLE grn.procurement_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE grn.procurement_inspections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON grn.procurement_inspections;
DROP POLICY IF EXISTS tenant_isolation ON grn.procurement_inspections;
CREATE POLICY tenant_isolation_policy ON grn.procurement_inspections
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- indent.procurement_indent_items
ALTER TABLE indent.procurement_indent_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE indent.procurement_indent_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON indent.procurement_indent_items;
DROP POLICY IF EXISTS tenant_isolation ON indent.procurement_indent_items;
CREATE POLICY tenant_isolation_policy ON indent.procurement_indent_items
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- indent.procurement_indents
ALTER TABLE indent.procurement_indents ENABLE ROW LEVEL SECURITY;
ALTER TABLE indent.procurement_indents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON indent.procurement_indents;
DROP POLICY IF EXISTS tenant_isolation ON indent.procurement_indents;
CREATE POLICY tenant_isolation_policy ON indent.procurement_indents
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- payments.procurement_advances
ALTER TABLE payments.procurement_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.procurement_advances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.procurement_advances;
DROP POLICY IF EXISTS tenant_isolation ON payments.procurement_advances;
CREATE POLICY tenant_isolation_policy ON payments.procurement_advances
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- payments.procurement_debit_notes
ALTER TABLE payments.procurement_debit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.procurement_debit_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.procurement_debit_notes;
DROP POLICY IF EXISTS tenant_isolation ON payments.procurement_debit_notes;
CREATE POLICY tenant_isolation_policy ON payments.procurement_debit_notes
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- po.procurement_po_items
ALTER TABLE po.procurement_po_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE po.procurement_po_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON po.procurement_po_items;
DROP POLICY IF EXISTS tenant_isolation ON po.procurement_po_items;
CREATE POLICY tenant_isolation_policy ON po.procurement_po_items
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- po.procurement_pos
ALTER TABLE po.procurement_pos ENABLE ROW LEVEL SECURITY;
ALTER TABLE po.procurement_pos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON po.procurement_pos;
DROP POLICY IF EXISTS tenant_isolation ON po.procurement_pos;
CREATE POLICY tenant_isolation_policy ON po.procurement_pos
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- procurement.three_way_match
ALTER TABLE procurement.three_way_match ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.three_way_match FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON procurement.three_way_match;
DROP POLICY IF EXISTS tenant_isolation ON procurement.three_way_match;
CREATE POLICY tenant_isolation_policy ON procurement.three_way_match
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- procurement.vendor_blacklist
ALTER TABLE procurement.vendor_blacklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.vendor_blacklist FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON procurement.vendor_blacklist;
DROP POLICY IF EXISTS tenant_isolation ON procurement.vendor_blacklist;
CREATE POLICY tenant_isolation_policy ON procurement.vendor_blacklist
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- rfq.procurement_rfq_items
ALTER TABLE rfq.procurement_rfq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq.procurement_rfq_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON rfq.procurement_rfq_items;
DROP POLICY IF EXISTS tenant_isolation ON rfq.procurement_rfq_items;
CREATE POLICY tenant_isolation_policy ON rfq.procurement_rfq_items
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- rfq.procurement_rfqs
ALTER TABLE rfq.procurement_rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq.procurement_rfqs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON rfq.procurement_rfqs;
DROP POLICY IF EXISTS tenant_isolation ON rfq.procurement_rfqs;
CREATE POLICY tenant_isolation_policy ON rfq.procurement_rfqs
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- security.procurement_emd
ALTER TABLE security.procurement_emd ENABLE ROW LEVEL SECURITY;
ALTER TABLE security.procurement_emd FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON security.procurement_emd;
DROP POLICY IF EXISTS tenant_isolation ON security.procurement_emd;
CREATE POLICY tenant_isolation_policy ON security.procurement_emd
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- security.procurement_pbg
ALTER TABLE security.procurement_pbg ENABLE ROW LEVEL SECURITY;
ALTER TABLE security.procurement_pbg FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON security.procurement_pbg;
DROP POLICY IF EXISTS tenant_isolation ON security.procurement_pbg;
CREATE POLICY tenant_isolation_policy ON security.procurement_pbg
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- tender.procurement_tender_bids
ALTER TABLE tender.procurement_tender_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender.procurement_tender_bids FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tender.procurement_tender_bids;
DROP POLICY IF EXISTS tenant_isolation ON tender.procurement_tender_bids;
CREATE POLICY tenant_isolation_policy ON tender.procurement_tender_bids
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- tender.procurement_tender_financial_bids
ALTER TABLE tender.procurement_tender_financial_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender.procurement_tender_financial_bids FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tender.procurement_tender_financial_bids;
DROP POLICY IF EXISTS tenant_isolation ON tender.procurement_tender_financial_bids;
CREATE POLICY tenant_isolation_policy ON tender.procurement_tender_financial_bids
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- tender.procurement_tenders
ALTER TABLE tender.procurement_tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender.procurement_tenders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tender.procurement_tenders;
DROP POLICY IF EXISTS tenant_isolation ON tender.procurement_tenders;
CREATE POLICY tenant_isolation_policy ON tender.procurement_tenders
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- vendor.procurement_empanelment
ALTER TABLE vendor.procurement_empanelment ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.procurement_empanelment FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON vendor.procurement_empanelment;
DROP POLICY IF EXISTS tenant_isolation ON vendor.procurement_empanelment;
CREATE POLICY tenant_isolation_policy ON vendor.procurement_empanelment
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- vendor.procurement_vendor_docs
ALTER TABLE vendor.procurement_vendor_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.procurement_vendor_docs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON vendor.procurement_vendor_docs;
DROP POLICY IF EXISTS tenant_isolation ON vendor.procurement_vendor_docs;
CREATE POLICY tenant_isolation_policy ON vendor.procurement_vendor_docs
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- vendor.procurement_vendors
ALTER TABLE vendor.procurement_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.procurement_vendors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON vendor.procurement_vendors;
DROP POLICY IF EXISTS tenant_isolation ON vendor.procurement_vendors;
CREATE POLICY tenant_isolation_policy ON vendor.procurement_vendors
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = indent.current_tenant_id())
      WITH CHECK (tenant_id = indent.current_tenant_id())';
  END IF;
END $$;
