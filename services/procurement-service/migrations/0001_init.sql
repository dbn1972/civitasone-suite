-- procurement-service initial migration
-- Run as: procurement_svc on civitas_procurement
-- Schemas _outbox, _inbox, po, grn are pre-created by DB bootstrap.
-- This migration creates remaining schemas + all tables.

CREATE SCHEMA IF NOT EXISTS indent;
CREATE SCHEMA IF NOT EXISTS vendor;
CREATE SCHEMA IF NOT EXISTS po;
CREATE SCHEMA IF NOT EXISTS grn;
CREATE SCHEMA IF NOT EXISTS auction;
CREATE SCHEMA IF NOT EXISTS payments;

-- ── indent module ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS indent.procurement_indents (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  indent_no        text        NOT NULL,
  department       text        NOT NULL,
  purpose          text        NOT NULL,
  total_minor      bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  status           varchar(24) NOT NULL DEFAULT 'draft',  -- draft|pending|approved|rejected|closed
  indent_date      date        NOT NULL DEFAULT CURRENT_DATE,
  required_by      date,
  sanction_ref     text,                                   -- opaque "finance_sanction:UUID"
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, indent_no)
);

CREATE TABLE IF NOT EXISTS indent.procurement_indent_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  indent_id        uuid        NOT NULL,
  tenant_id        uuid        NOT NULL,
  item_code        text        NOT NULL,
  description      text        NOT NULL,
  quantity         integer     NOT NULL DEFAULT 1,
  unit             varchar(32) NOT NULL DEFAULT 'nos',
  unit_price_minor bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_indents_tenant_status
  ON indent.procurement_indents (tenant_id, status);

-- ── vendor module ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendor.procurement_vendors (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  name             text        NOT NULL,
  gstin            text,
  pan              text,
  email            text,
  phone            text,
  vendor_type      varchar(24) NOT NULL DEFAULT 'registered'
                     CHECK (vendor_type IN ('registered','empanelled','blacklisted')),
  mse              boolean     NOT NULL DEFAULT false,
  msme             boolean     NOT NULL DEFAULT false,
  udyam_no         text,
  bank_account     text,
  ifsc             text,
  blacklist_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, gstin)
);

CREATE TABLE IF NOT EXISTS vendor.procurement_vendor_docs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        uuid        NOT NULL,
  tenant_id        uuid        NOT NULL,
  doc_type         text        NOT NULL,  -- pan|gst|msme|empanelment_cert|...
  file_ref         text        NOT NULL,  -- opaque S3/MinIO ref
  verified         boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vendor.procurement_empanelment (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        uuid        NOT NULL,
  tenant_id        uuid        NOT NULL,
  category         text        NOT NULL,
  empanel_date     date        NOT NULL DEFAULT CURRENT_DATE,
  valid_until      date,
  status           varchar(24) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_vendors_tenant
  ON vendor.procurement_vendors (tenant_id, vendor_type);

-- ── po module ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS po.procurement_pos (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  po_no            text        NOT NULL,
  vendor_id        uuid        NOT NULL,
  indent_ref       text        NOT NULL,  -- opaque "procurement_indent:UUID"
  sanction_ref     text,                  -- opaque "finance_sanction:UUID"
  rate_contract_ref text,                 -- opaque "contract_rate:UUID"
  gem_order_no     text,
  total_minor      bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  status           varchar(24) NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','approved','gem_placed','dispatched','closed','cancelled')),
  delivery_date    date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, po_no)
);

CREATE TABLE IF NOT EXISTS po.procurement_po_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id            uuid        NOT NULL,
  tenant_id        uuid        NOT NULL,
  item_code        text        NOT NULL,
  description      text        NOT NULL,
  quantity         integer     NOT NULL DEFAULT 1,
  unit             varchar(32) NOT NULL DEFAULT 'nos',
  unit_price_minor bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_pos_tenant_status
  ON po.procurement_pos (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_vendor
  ON po.procurement_pos (vendor_id);

-- ── grn module ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS grn.procurement_grns (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  grn_no           text        NOT NULL,
  po_ref           text        NOT NULL,  -- opaque "procurement_po:UUID"
  vendor_id        uuid        NOT NULL,
  received_date    date        NOT NULL DEFAULT CURRENT_DATE,
  three_way_match  boolean     NOT NULL DEFAULT false,
  status           varchar(24) NOT NULL DEFAULT 'draft',  -- draft|accepted|rejected|partial
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, grn_no)
);

CREATE TABLE IF NOT EXISTS grn.procurement_grn_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id           uuid        NOT NULL,
  tenant_id        uuid        NOT NULL,
  po_item_ref      text        NOT NULL,  -- opaque "procurement_po_item:UUID"
  item_code        text        NOT NULL,
  ordered_qty      integer     NOT NULL DEFAULT 0,
  received_qty     integer     NOT NULL DEFAULT 0,
  accepted_qty     integer     NOT NULL DEFAULT 0,
  unit             varchar(32) NOT NULL DEFAULT 'nos',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS grn.procurement_inspections (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id           uuid        NOT NULL,
  tenant_id        uuid        NOT NULL,
  inspector_id     uuid        NOT NULL,
  inspection_date  date        NOT NULL DEFAULT CURRENT_DATE,
  result           varchar(16) NOT NULL DEFAULT 'pending',  -- pending|pass|fail
  remarks          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_grns_tenant
  ON grn.procurement_grns (tenant_id, status);

-- ── auction module ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auction.procurement_auctions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  auction_no       text        NOT NULL,
  indent_ref       text        NOT NULL,  -- opaque "procurement_indent:UUID"
  title            text        NOT NULL,
  reserve_minor    bigint      NOT NULL DEFAULT 0,  -- reserve/estimate price
  currency         char(3)     NOT NULL DEFAULT 'INR',
  start_at         timestamptz NOT NULL,
  end_at           timestamptz NOT NULL,
  status           varchar(24) NOT NULL DEFAULT 'draft',
  winning_bid_id   uuid,
  mse_preference   boolean     NOT NULL DEFAULT true,  -- GFR rule 153: 15% price preference
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, auction_no)
);

CREATE TABLE IF NOT EXISTS auction.procurement_bids (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id       uuid        NOT NULL,
  tenant_id        uuid        NOT NULL,
  vendor_id        uuid        NOT NULL,
  bid_minor        bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  is_mse           boolean     NOT NULL DEFAULT false,
  effective_minor  bigint      NOT NULL DEFAULT 0,  -- after MSE preference applied
  rank             integer,
  bid_at           timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_bids_auction
  ON auction.procurement_bids (auction_id, effective_minor);

-- ── payments module ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments.procurement_advances (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  po_ref           text        NOT NULL,  -- opaque "procurement_po:UUID"
  vendor_id        uuid        NOT NULL,
  amount_minor     bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  advance_type     varchar(32) NOT NULL DEFAULT 'mobilisation',  -- mobilisation|material
  status           varchar(24) NOT NULL DEFAULT 'pending',
  recovery_minor   bigint      NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payments.procurement_debit_notes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  grn_ref          text        NOT NULL,  -- opaque "procurement_grn:UUID"
  vendor_id        uuid        NOT NULL,
  reason           text        NOT NULL,
  amount_minor     bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  status           varchar(24) NOT NULL DEFAULT 'draft',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

-- ── outbox / inbox ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic            varchar(128) NOT NULL,
  event_type       varchar(128) NOT NULL,
  tenant_id        uuid        NOT NULL,
  actor_id         uuid        NOT NULL,
  correlation_id   varchar(64) NOT NULL,
  payload          jsonb       NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz
);

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id       uuid        PRIMARY KEY,
  processed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON _outbox.messages (created_at) WHERE published_at IS NULL;
