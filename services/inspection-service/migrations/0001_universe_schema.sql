-- =============================================================================
-- Migration: 0001_universe_schema.sql
-- Service:   inspection-service
-- Schema:    universe
-- Purpose:   Create universe schema with regulated_entities, inspection_types,
--            provisions, and vocabularies tables for the inspection field
--            operations module.
-- Requirements: 2.1, 2.3, 2.7
--
-- Rollback Strategy:
--   DROP POLICY IF EXISTS tenant_isolation ON universe.vocabularies;
--   DROP POLICY IF EXISTS tenant_isolation ON universe.provisions;
--   DROP POLICY IF EXISTS tenant_isolation ON universe.inspection_types;
--   DROP POLICY IF EXISTS tenant_isolation ON universe.regulated_entities;
--   DROP INDEX IF EXISTS universe.idx_regulated_entities_fts;
--   DROP INDEX IF EXISTS universe.idx_regulated_entities_tenant_risk;
--   DROP INDEX IF EXISTS universe.idx_inspection_types_tenant;
--   DROP INDEX IF EXISTS universe.idx_provisions_tenant;
--   DROP INDEX IF EXISTS universe.idx_vocabularies_tenant_category;
--   DROP TABLE IF EXISTS universe.vocabularies;
--   DROP TABLE IF EXISTS universe.provisions;
--   DROP TABLE IF EXISTS universe.inspection_types;
--   DROP TABLE IF EXISTS universe.regulated_entities;
--   DROP SCHEMA IF EXISTS universe;
-- =============================================================================

SET lock_timeout = '5s';

-- ── Schema ────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS universe;

-- ── Helper function for RLS ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION universe.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- ── regulated_entities ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS universe.regulated_entities (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  registration_no  text        NOT NULL,
  entity_type      varchar(48) NOT NULL,
  name             text        NOT NULL,
  jurisdiction     text        NOT NULL,
  address_line1    text        NOT NULL,
  address_line2    text,
  city             text        NOT NULL,
  state            text        NOT NULL,
  pincode          varchar(10) NOT NULL,
  latitude         numeric(10, 7),
  longitude        numeric(10, 7),
  risk_category    varchar(24) NOT NULL DEFAULT 'medium',
  metadata         jsonb,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, registration_no)
);

-- GIN index for full-text search on name, registration_no, address
CREATE INDEX IF NOT EXISTS idx_regulated_entities_fts
  ON universe.regulated_entities
  USING gin (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(registration_no, '') || ' ' || coalesce(address_line1, '') || ' ' || coalesce(city, ''))
  );

-- B-tree index for risk-based filtering per tenant
CREATE INDEX IF NOT EXISTS idx_regulated_entities_tenant_risk
  ON universe.regulated_entities (tenant_id, risk_category)
  WHERE deleted_at IS NULL;

-- ── inspection_types ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS universe.inspection_types (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL,
  name                    text        NOT NULL,
  code                    varchar(32) NOT NULL,
  applicable_entity_types jsonb       NOT NULL DEFAULT '[]'::jsonb,
  required_competencies   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  default_template_ids    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  regulatory_basis        jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid        NOT NULL,
  updated_by              uuid        NOT NULL,
  version                 integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_inspection_types_tenant
  ON universe.inspection_types (tenant_id);

-- ── provisions ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS universe.provisions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  act_reference    text        NOT NULL,
  section_number   text        NOT NULL,
  description      text        NOT NULL,
  penalty_clause   text,
  severity_class   varchar(16) NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_provisions_tenant
  ON universe.provisions (tenant_id);

-- ── vocabularies ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS universe.vocabularies (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  category         varchar(48) NOT NULL,
  code             varchar(32) NOT NULL,
  label            text        NOT NULL,
  sort_order       integer     NOT NULL DEFAULT 0,
  is_active        integer     NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, category, code)
);

CREATE INDEX IF NOT EXISTS idx_vocabularies_tenant_category
  ON universe.vocabularies (tenant_id, category)
  WHERE is_active = 1;

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE universe.regulated_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE universe.inspection_types   ENABLE ROW LEVEL SECURITY;
ALTER TABLE universe.provisions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE universe.vocabularies       ENABLE ROW LEVEL SECURITY;

ALTER TABLE universe.regulated_entities FORCE ROW LEVEL SECURITY;
ALTER TABLE universe.inspection_types   FORCE ROW LEVEL SECURITY;
ALTER TABLE universe.provisions         FORCE ROW LEVEL SECURITY;
ALTER TABLE universe.vocabularies       FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON universe.regulated_entities;
DROP POLICY IF EXISTS tenant_isolation ON universe.inspection_types;
DROP POLICY IF EXISTS tenant_isolation ON universe.provisions;
DROP POLICY IF EXISTS tenant_isolation ON universe.vocabularies;

CREATE POLICY tenant_isolation ON universe.regulated_entities
  USING (tenant_id = universe.current_tenant_id());

CREATE POLICY tenant_isolation ON universe.inspection_types
  USING (tenant_id = universe.current_tenant_id());

CREATE POLICY tenant_isolation ON universe.provisions
  USING (tenant_id = universe.current_tenant_id());

CREATE POLICY tenant_isolation ON universe.vocabularies
  USING (tenant_id = universe.current_tenant_id());
