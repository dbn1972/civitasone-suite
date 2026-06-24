-- 0008_competitive_procurement.sql
-- Wave 2: competitive two-bid tender lifecycle, EMD/bid-security + PBG, and the
-- PO status CHECK fix. Additive + idempotent only.

-- ── (3) Fix the PO status CHECK ────────────────────────────────────────────────
-- poCreate inserts status 'pending' (and SoD path can 'reject'); the original
-- CHECK from 0001 omits both, so any API-created PO violates the constraint.
-- Widen the CHECK to include every status the code actually writes.
ALTER TABLE po.procurement_pos DROP CONSTRAINT IF EXISTS procurement_pos_status_check;
ALTER TABLE po.procurement_pos ADD CONSTRAINT procurement_pos_status_check
  CHECK (status IN ('draft','pending','approved','rejected','gem_placed','dispatched','closed','cancelled'));

-- ── (1) Competitive tender lifecycle ───────────────────────────────────────────
-- Extend the (read-only) tender tables with lifecycle columns the commands need.
ALTER TABLE tender.procurement_tenders ADD COLUMN IF NOT EXISTS nit_ref TEXT;
ALTER TABLE tender.procurement_tenders ADD COLUMN IF NOT EXISTS emd_amount_minor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tender.procurement_tenders ADD COLUMN IF NOT EXISTS awarded_bid_id UUID;
ALTER TABLE tender.procurement_tenders ADD COLUMN IF NOT EXISTS awarded_vendor_id UUID;

-- Technical envelope lives on the (existing) bids row. Add qualification state.
ALTER TABLE tender.procurement_tender_bids ADD COLUMN IF NOT EXISTS bid_no TEXT;
ALTER TABLE tender.procurement_tender_bids ADD COLUMN IF NOT EXISTS technical_qualified BOOLEAN;
ALTER TABLE tender.procurement_tender_bids ADD COLUMN IF NOT EXISTS qualification_notes TEXT;
ALTER TABLE tender.procurement_tender_bids ADD COLUMN IF NOT EXISTS financial_opened BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tender.procurement_tender_bids ADD COLUMN IF NOT EXISTS rank INTEGER;
ALTER TABLE tender.procurement_tender_bids ADD COLUMN IF NOT EXISTS is_l1 BOOLEAN NOT NULL DEFAULT false;
-- vendor_id should NOT auto-generate; the original DDL gave it a defaultRandom.
ALTER TABLE tender.procurement_tender_bids ALTER COLUMN vendor_id DROP DEFAULT;

CREATE INDEX IF NOT EXISTS ix_tender_bids_tender
  ON tender.procurement_tender_bids (tenant_id, tender_id);

-- SEALED FINANCIAL ENVELOPE: stored in a SEPARATE table so the financial value
-- is never selected by the technical-evaluation / bid read paths. The amount is
-- only revealed after the bid is technically qualified AND the envelope opened.
CREATE TABLE IF NOT EXISTS tender.procurement_tender_financial_bids (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id          uuid        NOT NULL,
  tender_id       uuid        NOT NULL,
  tenant_id       uuid        NOT NULL,
  vendor_id       uuid        NOT NULL,
  amount_minor    bigint      NOT NULL,
  currency        char(3)     NOT NULL DEFAULT 'INR',
  sealed          boolean     NOT NULL DEFAULT true,   -- true until financial open
  opened_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  version         integer     NOT NULL DEFAULT 1,
  UNIQUE (bid_id)
);
CREATE INDEX IF NOT EXISTS ix_tender_fin_bids_tender
  ON tender.procurement_tender_financial_bids (tenant_id, tender_id);

-- ── (2) EMD / bid-security + performance-security (PBG) ─────────────────────────
CREATE SCHEMA IF NOT EXISTS security;

CREATE TABLE IF NOT EXISTS security.procurement_emd (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  emd_no          text        NOT NULL,
  tender_id       uuid,
  bid_id          uuid,
  vendor_id       uuid        NOT NULL,
  amount_minor    bigint      NOT NULL,
  currency        char(3)     NOT NULL DEFAULT 'INR',
  instrument      varchar(24) NOT NULL DEFAULT 'bank_guarantee', -- bank_guarantee|dd|online
  status          varchar(16) NOT NULL DEFAULT 'collected'
                    CHECK (status IN ('collected','forfeited','refunded')),
  forfeit_reason  text,
  collected_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  version         integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, emd_no)
);
CREATE INDEX IF NOT EXISTS ix_emd_tender ON security.procurement_emd (tenant_id, tender_id);
CREATE INDEX IF NOT EXISTS ix_emd_vendor ON security.procurement_emd (tenant_id, vendor_id, status);

CREATE TABLE IF NOT EXISTS security.procurement_pbg (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  pbg_no          text        NOT NULL,
  po_ref          text,
  tender_id       uuid,
  vendor_id       uuid        NOT NULL,
  amount_minor    bigint      NOT NULL,
  currency        char(3)     NOT NULL DEFAULT 'INR',
  instrument      varchar(24) NOT NULL DEFAULT 'bank_guarantee',
  valid_until     date,
  status          varchar(16) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','forfeited','released')),
  forfeit_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  version         integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, pbg_no)
);
CREATE INDEX IF NOT EXISTS ix_pbg_vendor ON security.procurement_pbg (tenant_id, vendor_id, status);

-- NOTE: schema "tender" is owned by civitas_admin (superuser), not procurement_svc.
-- The tender.* ALTER/CREATE statements above plus these grants were applied as
-- civitas_admin. Idempotent; safe to re-run as the schema owner.
GRANT USAGE ON SCHEMA tender TO procurement_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tender TO procurement_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA tender GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO procurement_svc;

-- Widen tender + bid status columns to fit the new lifecycle states
-- ('technical_evaluation','financial_evaluation','technically_qualified', etc.).
-- Applied as civitas_admin (schema owner). Idempotent.
ALTER TABLE tender.procurement_tenders ALTER COLUMN status TYPE varchar(24);
ALTER TABLE tender.procurement_tender_bids ALTER COLUMN status TYPE varchar(24);
