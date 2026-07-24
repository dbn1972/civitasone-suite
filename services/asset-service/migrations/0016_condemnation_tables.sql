-- Migration: 0016_condemnation_tables.sql
-- Purpose: Add condemnation survey, committee recommendation, and auction tables
--          to the existing `lifecycle` schema for the condemnation module (SVC-060).
-- Affected service: asset-service
-- Rollback: DROP TABLE IF EXISTS lifecycle.asset_auctions;
--           DROP TABLE IF EXISTS lifecycle.condemnation_recommendations;
--           DROP TABLE IF EXISTS lifecycle.condemnation_surveys;

SET lock_timeout = '5s';

-- ── condemnation_surveys ────────────────────────────────────────────────────
-- Physical assessment of an asset's condition prior to condemnation.

CREATE TABLE IF NOT EXISTS lifecycle.condemnation_surveys (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid        NOT NULL,
  asset_id                    uuid        NOT NULL,
  survey_date                 date        NOT NULL,
  surveyed_by                 uuid        NOT NULL,
  condition                   varchar(32) NOT NULL,
  condition_notes             text,
  years_in_use                integer,
  estimated_repair_cost_minor bigint,
  currency                    char(3)     NOT NULL DEFAULT 'INR',
  recommendation              varchar(32) NOT NULL DEFAULT 'pending',
  attachments                 jsonb,
  status                      varchar(24) NOT NULL DEFAULT 'draft',
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid        NOT NULL,
  updated_by                  uuid        NOT NULL,
  version                     integer     NOT NULL DEFAULT 1
);

-- ── condemnation_recommendations ────────────────────────────────────────────
-- Committee decision: condemn / repair / continue (GFR Rule 196 maker-checker).

CREATE TABLE IF NOT EXISTS lifecycle.condemnation_recommendations (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  survey_id          uuid        NOT NULL,
  asset_id           uuid        NOT NULL,
  committee_members  jsonb       NOT NULL,
  decision           varchar(32) NOT NULL,
  reason             text        NOT NULL,
  reserve_value_minor bigint,
  floor_value_minor   bigint,
  currency           char(3)     NOT NULL DEFAULT 'INR',
  approved_by        uuid,
  approved_at        timestamptz,
  status             varchar(24) NOT NULL DEFAULT 'pending',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1
);

-- ── asset_auctions ──────────────────────────────────────────────────────────
-- Auction process for condemned assets; sale proceeds flow to finance receipt.

CREATE TABLE IF NOT EXISTS lifecycle.asset_auctions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  asset_id            uuid        NOT NULL,
  recommendation_id   uuid        NOT NULL,
  reserve_value_minor bigint      NOT NULL,
  currency            char(3)     NOT NULL DEFAULT 'INR',
  auction_ref         text,
  auction_date        date,
  highest_bid_minor   bigint,
  winner_name         text,
  winner_ref          text,
  sale_proceeds_minor bigint,
  finance_receipt_ref text,
  status              varchar(24) NOT NULL DEFAULT 'pending',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_by          uuid        NOT NULL,
  version             integer     NOT NULL DEFAULT 1
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_condemnation_surveys_tenant_asset
  ON lifecycle.condemnation_surveys (tenant_id, asset_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_condemnation_recommendations_tenant_asset
  ON lifecycle.condemnation_recommendations (tenant_id, asset_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_condemnation_recommendations_survey
  ON lifecycle.condemnation_recommendations (survey_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_auctions_tenant_asset
  ON lifecycle.asset_auctions (tenant_id, asset_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_auctions_recommendation
  ON lifecycle.asset_auctions (recommendation_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE lifecycle.condemnation_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.condemnation_surveys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.condemnation_surveys;
CREATE POLICY tenant_isolation_policy ON lifecycle.condemnation_surveys
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

ALTER TABLE lifecycle.condemnation_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.condemnation_recommendations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.condemnation_recommendations;
CREATE POLICY tenant_isolation_policy ON lifecycle.condemnation_recommendations
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

ALTER TABLE lifecycle.asset_auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.asset_auctions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.asset_auctions;
CREATE POLICY tenant_isolation_policy ON lifecycle.asset_auctions
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());
