-- procurement-service RLS migration: tenant isolation backstop
-- Role: procurement_svc on civitas_procurement
-- Applied AFTER 0009_tender_sod_sanction.sql
-- Additive only — no DROP TABLE, no ALTER COLUMN, no data changes.

-- Helper function: reads app.tenant_id from session variable (SET LOCAL by middleware)
CREATE OR REPLACE FUNCTION po.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- ── po schema ─────────────────────────────────────────────────────
ALTER TABLE po.procurement_pos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE po.procurement_po_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE po.procurement_pos      FORCE ROW LEVEL SECURITY;
ALTER TABLE po.procurement_po_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON po.procurement_pos;
DROP POLICY IF EXISTS tenant_isolation ON po.procurement_po_items;

CREATE POLICY tenant_isolation ON po.procurement_pos
  USING (tenant_id = po.current_tenant_id());
CREATE POLICY tenant_isolation ON po.procurement_po_items
  USING (tenant_id = po.current_tenant_id());

-- ── vendor schema ─────────────────────────────────────────────────
ALTER TABLE vendor.procurement_vendors      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.procurement_empanelment  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.procurement_vendors      FORCE ROW LEVEL SECURITY;
ALTER TABLE vendor.procurement_empanelment  FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON vendor.procurement_vendors;
DROP POLICY IF EXISTS tenant_isolation ON vendor.procurement_empanelment;

CREATE POLICY tenant_isolation ON vendor.procurement_vendors
  USING (tenant_id = po.current_tenant_id());
CREATE POLICY tenant_isolation ON vendor.procurement_empanelment
  USING (tenant_id = po.current_tenant_id());

-- ── auction schema ────────────────────────────────────────────────
ALTER TABLE auction.procurement_bids     ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.procurement_auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.procurement_bids     FORCE ROW LEVEL SECURITY;
ALTER TABLE auction.procurement_auctions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON auction.procurement_bids;
DROP POLICY IF EXISTS tenant_isolation ON auction.procurement_auctions;

CREATE POLICY tenant_isolation ON auction.procurement_bids
  USING (tenant_id = po.current_tenant_id());
CREATE POLICY tenant_isolation ON auction.procurement_auctions
  USING (tenant_id = po.current_tenant_id());

-- ── _outbox schema ────────────────────────────────────────────────
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages
  USING (tenant_id = po.current_tenant_id());
