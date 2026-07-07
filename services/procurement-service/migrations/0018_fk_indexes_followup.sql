-- Purpose: Follow-up FK index audit — create remaining missing FK-lookup indexes
--          not covered by the earlier fk_indexes migration, using CREATE INDEX CONCURRENTLY.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: procurement-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- auction.procurement_auctions.winning_bid_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_auctions_winning_bid_id
  ON auction.procurement_auctions (winning_bid_id);

-- grn.procurement_grns.vendor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_grns_vendor_id
  ON grn.procurement_grns (vendor_id);

-- rfq.procurement_rfq_items.rfq_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_rfq_items_rfq_id
  ON rfq.procurement_rfq_items (rfq_id);

-- security.procurement_emd.tender_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_emd_tender_id
  ON security.procurement_emd (tender_id);

-- security.procurement_emd.bid_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_emd_bid_id
  ON security.procurement_emd (bid_id);

-- security.procurement_emd.vendor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_emd_vendor_id
  ON security.procurement_emd (vendor_id);

-- security.procurement_pbg.tender_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_pbg_tender_id
  ON security.procurement_pbg (tender_id);

-- security.procurement_pbg.vendor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_pbg_vendor_id
  ON security.procurement_pbg (vendor_id);

-- tender.procurement_tenders.awarded_bid_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_tenders_awarded_bid_id
  ON tender.procurement_tenders (awarded_bid_id);

-- tender.procurement_tenders.awarded_vendor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_tenders_awarded_vendor_id
  ON tender.procurement_tenders (awarded_vendor_id);

-- tender.procurement_tender_bids.tender_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_tender_bids_tender_id
  ON tender.procurement_tender_bids (tender_id);

-- tender.procurement_tender_bids.vendor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_tender_bids_vendor_id
  ON tender.procurement_tender_bids (vendor_id);

-- tender.procurement_tender_financial_bids.bid_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_tender_financial_bids_bid_id
  ON tender.procurement_tender_financial_bids (bid_id);

-- tender.procurement_tender_financial_bids.tender_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_tender_financial_bids_tender_id
  ON tender.procurement_tender_financial_bids (tender_id);

-- tender.procurement_tender_financial_bids.vendor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_tender_financial_bids_vendor_id
  ON tender.procurement_tender_financial_bids (vendor_id);

-- procurement.three_way_match.po_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_three_way_match_po_id
  ON procurement.three_way_match (po_id);

-- procurement.three_way_match.grn_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_three_way_match_grn_id
  ON procurement.three_way_match (grn_id);

-- procurement.three_way_match.invoice_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_three_way_match_invoice_id
  ON procurement.three_way_match (invoice_id);

-- procurement.vendor_blacklist.vendor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vendor_blacklist_vendor_id
  ON procurement.vendor_blacklist (vendor_id);
