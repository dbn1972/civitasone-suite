-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: procurement-service

SET lock_timeout = '5s';

-- ============================================================================
-- indent.procurement_indents.status
-- Valid states from domain.ts: draft, pending, tender_required, approved, rejected, closed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE indent.procurement_indents
    ADD CONSTRAINT procurement_indents_status_check
    CHECK (status IN ('draft', 'pending', 'tender_required', 'approved', 'rejected', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- tender.procurement_tenders.status
-- Valid states from domain.ts: draft, published, technical_evaluation,
-- financial_evaluation, awarded, cancelled, pending_approval. "evaluation" is
-- also retained: queries.ts's TENDER_STATUSES lists it explicitly and
-- pre-existing rows carry it (a collapsed display value written by an
-- earlier version of the tender flow).
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE tender.procurement_tenders
    ADD CONSTRAINT procurement_tenders_status_check
    CHECK (status IN ('draft', 'published', 'technical_evaluation', 'financial_evaluation', 'evaluation', 'awarded', 'cancelled', 'pending_approval'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- tender.procurement_tenders.type
-- Valid states from validators.ts createTenderBody: open, limited, single_source, gem
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE tender.procurement_tenders
    ADD CONSTRAINT procurement_tenders_type_check
    CHECK (type IN ('open', 'limited', 'single_source', 'gem'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- tender.procurement_tender_bids.status
-- Valid states: submitted, technically_qualified, technically_rejected, financial_opened, awarded, evaluated
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE tender.procurement_tender_bids
    ADD CONSTRAINT procurement_tender_bids_status_check
    CHECK (status IN ('submitted', 'technically_qualified', 'technically_rejected', 'financial_opened', 'awarded', 'evaluated'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- grn.procurement_grns.status
-- Valid states: draft, accepted, rejected, partial
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE grn.procurement_grns
    ADD CONSTRAINT procurement_grns_status_check
    CHECK (status IN ('draft', 'accepted', 'rejected', 'partial'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- procurement.three_way_match.match_status
-- Valid states: pending, matched, mismatch, exception
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE procurement.three_way_match
    ADD CONSTRAINT three_way_match_match_status_check
    CHECK (match_status IN ('pending', 'matched', 'mismatch', 'exception'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- security.procurement_emd.status
-- Valid states: collected, forfeited, refunded (inline CHECK in 0008)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE security.procurement_emd
    ADD CONSTRAINT procurement_emd_status_check
    CHECK (status IN ('collected', 'forfeited', 'refunded'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- security.procurement_pbg.status
-- Valid states from domain.ts: active, forfeited, released (inline CHECK in 0008)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE security.procurement_pbg
    ADD CONSTRAINT procurement_pbg_status_check
    CHECK (status IN ('active', 'forfeited', 'released'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- procurement.vendor_blacklist.status
-- Valid states: active, reinstated
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE procurement.vendor_blacklist
    ADD CONSTRAINT vendor_blacklist_status_check
    CHECK (status IN ('active', 'reinstated'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- vendor.procurement_empanelment.status
-- Valid states: active, expired, suspended, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE vendor.procurement_empanelment
    ADD CONSTRAINT procurement_empanelment_status_check
    CHECK (status IN ('active', 'expired', 'suspended', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- vendor.procurement_vendors.kyc_status
-- Valid states: pending, verified, rejected
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE vendor.procurement_vendors
    ADD CONSTRAINT procurement_vendors_kyc_status_check
    CHECK (kyc_status IN ('pending', 'verified', 'rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- rfq.procurement_rfqs.status
-- Valid states: draft, issued, closed, cancelled, awarded
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE rfq.procurement_rfqs
    ADD CONSTRAINT procurement_rfqs_status_check
    CHECK (status IN ('draft', 'issued', 'closed', 'cancelled', 'awarded'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- auction.procurement_auctions.status
-- Valid states: draft, published, active, closed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE auction.procurement_auctions
    ADD CONSTRAINT procurement_auctions_status_check
    CHECK (status IN ('draft', 'published', 'active', 'closed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payments.procurement_advances.status
-- Valid states: pending, approved, disbursed, recovered, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payments.procurement_advances
    ADD CONSTRAINT procurement_advances_status_check
    CHECK (status IN ('pending', 'approved', 'disbursed', 'recovered', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payments.procurement_debit_notes.status
-- Valid states: draft (schema default; no transition path implemented yet)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payments.procurement_debit_notes
    ADD CONSTRAINT procurement_debit_notes_status_check
    CHECK (status IN ('draft'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE indent.procurement_indents VALIDATE CONSTRAINT procurement_indents_status_check;
ALTER TABLE tender.procurement_tenders VALIDATE CONSTRAINT procurement_tenders_status_check;
ALTER TABLE tender.procurement_tenders VALIDATE CONSTRAINT procurement_tenders_type_check;
ALTER TABLE tender.procurement_tender_bids VALIDATE CONSTRAINT procurement_tender_bids_status_check;
ALTER TABLE grn.procurement_grns VALIDATE CONSTRAINT procurement_grns_status_check;
ALTER TABLE procurement.three_way_match VALIDATE CONSTRAINT three_way_match_match_status_check;
ALTER TABLE security.procurement_emd VALIDATE CONSTRAINT procurement_emd_status_check;
ALTER TABLE security.procurement_pbg VALIDATE CONSTRAINT procurement_pbg_status_check;
ALTER TABLE procurement.vendor_blacklist VALIDATE CONSTRAINT vendor_blacklist_status_check;
ALTER TABLE vendor.procurement_empanelment VALIDATE CONSTRAINT procurement_empanelment_status_check;
ALTER TABLE vendor.procurement_vendors VALIDATE CONSTRAINT procurement_vendors_kyc_status_check;
ALTER TABLE rfq.procurement_rfqs VALIDATE CONSTRAINT procurement_rfqs_status_check;
ALTER TABLE auction.procurement_auctions VALIDATE CONSTRAINT procurement_auctions_status_check;
ALTER TABLE payments.procurement_advances VALIDATE CONSTRAINT procurement_advances_status_check;
ALTER TABLE payments.procurement_debit_notes VALIDATE CONSTRAINT procurement_debit_notes_status_check;
