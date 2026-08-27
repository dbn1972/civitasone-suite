-- 0012_org_model.sql
-- District Governance Platform — Wave-A EPIC-1: org-model spine.
--
-- The `hierarchy` and `jurisdiction` modules ship Drizzle schemas + routes but
-- NO table was ever created (0006 tried to ALTER hierarchy.administrative_units,
-- which never existed). This migration creates the whole org model so a district
-- can be represented beyond the flat Tenant -> Department -> User model:
--
--   hierarchy.unit_types           — canonical level taxonomy (INSERT-only to add
--                                    state-specific levels; no DDL needed)
--   hierarchy.administrative_units — the geographic tree (state..village..beat)
--   hierarchy.offices              — a distinct office at a unit (Collectorate, SDM,
--                                    Tehsil, SP, DSP, Police Station, BDO, ...)
--   hierarchy.positions            — sanctioned posts within an office (Collector,
--                                    SDM, Tehsildar, SP, DSP, SHO, ...)
--   hierarchy.postings             — who holds which position at which office, with
--                                    effective dates + charge type (substantive/
--                                    acting/additional). This is what lets the JWT
--                                    carry officeId and RLS fence by jurisdiction.
--   jurisdiction.jurisdictions     — binds an office to the territory it covers.
--
-- Idempotent (IF NOT EXISTS). Rollback: DROP SCHEMA hierarchy, jurisdiction CASCADE.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS hierarchy AUTHORIZATION location_svc;
CREATE SCHEMA IF NOT EXISTS jurisdiction AUTHORIZATION location_svc;

-- current_tenant_id() (SECURITY DEFINER, fail-closed) is defined in 0006. Recreate
-- defensively so this migration is self-contained.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- ── unit_types (canonical taxonomy — reference data, NOT tenant-scoped) ───────
CREATE TABLE IF NOT EXISTS hierarchy.unit_types (
  code    VARCHAR(32) PRIMARY KEY,
  label   VARCHAR(120) NOT NULL,
  domain  VARCHAR(16)  NOT NULL DEFAULT 'civil',   -- civil|revenue|rural|urban|police
  rank    INT          NOT NULL DEFAULT 100,        -- advisory top-down ordering
  CONSTRAINT unit_types_domain_chk CHECK (domain IN ('civil','revenue','rural','urban','police'))
);

INSERT INTO hierarchy.unit_types (code, label, domain, rank) VALUES
  ('nation',              'Union / National',              'civil',   0),
  ('state',               'State',                          'civil',  10),
  ('division',            'Division (Commissioner)',        'civil',  20),
  ('range',               'Police Range',                   'police', 25),
  ('district',            'District',                       'civil',  30),
  ('police_district',     'Police District',                'police', 32),
  ('zone',                'Zone',                           'civil',  35),
  ('subdivision',         'Sub-division (SDM)',             'revenue',40),
  ('police_subdivision',  'Police Sub-division (DSP/SDPO)', 'police', 42),
  ('ulb',                 'Urban Local Body',               'urban',  45),
  ('circle',              'Police Circle',                  'police', 48),
  ('tehsil',              'Tehsil / Taluk / Mandal / Circle','revenue',50),
  ('block',               'Development Block (BDO)',        'rural',  50),
  ('police_station',      'Police Station (Thana)',         'police', 55),
  ('ward',                'Municipal Ward',                 'urban',  60),
  ('gp',                  'Gram Panchayat',                 'rural',  60),
  ('beat',                'Police Beat',                    'police', 65),
  ('village',             'Revenue Village',                'revenue',70)
ON CONFLICT (code) DO NOTHING;

GRANT SELECT ON hierarchy.unit_types TO location_svc;

-- ── administrative_units (the geographic tree) ───────────────────────────────
CREATE TABLE IF NOT EXISTS hierarchy.administrative_units (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  code        VARCHAR(32) NOT NULL,
  name        VARCHAR(200) NOT NULL,
  type        VARCHAR(32) NOT NULL REFERENCES hierarchy.unit_types(code),
  parent_id   UUID REFERENCES hierarchy.administrative_units(id),
  population  INT,
  area_km2    INT,
  pin_codes   JSONB,
  lgd_code    VARCHAR(32),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL,
  updated_by  UUID NOT NULL,
  version     INT NOT NULL DEFAULT 1,
  CONSTRAINT admin_units_tenant_code_uniq UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_admin_units_tenant_parent ON hierarchy.administrative_units(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_admin_units_tenant_type   ON hierarchy.administrative_units(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_admin_units_lgd           ON hierarchy.administrative_units(lgd_code);

-- ── offices (a distinct office located at an administrative unit) ─────────────
CREATE TABLE IF NOT EXISTS hierarchy.offices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  code             VARCHAR(64) NOT NULL,
  name             VARCHAR(240) NOT NULL,
  office_type      VARCHAR(48) NOT NULL,        -- collectorate|sdm_office|tehsil_office|sp_office|dsp_office|police_station|bdo_office|line_dept_office|...
  domain           VARCHAR(16) NOT NULL DEFAULT 'civil',
  admin_unit_id    UUID NOT NULL REFERENCES hierarchy.administrative_units(id),
  parent_office_id UUID REFERENCES hierarchy.offices(id),
  lgd_code         VARCHAR(32),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID NOT NULL,
  updated_by       UUID NOT NULL,
  version          INT NOT NULL DEFAULT 1,
  CONSTRAINT offices_tenant_code_uniq UNIQUE (tenant_id, code),
  CONSTRAINT offices_domain_chk CHECK (domain IN ('civil','revenue','rural','urban','police'))
);
CREATE INDEX IF NOT EXISTS idx_offices_tenant_unit   ON hierarchy.offices(tenant_id, admin_unit_id);
CREATE INDEX IF NOT EXISTS idx_offices_tenant_parent ON hierarchy.offices(tenant_id, parent_office_id);
CREATE INDEX IF NOT EXISTS idx_offices_tenant_domain ON hierarchy.offices(tenant_id, domain);

-- ── positions (sanctioned posts within an office) ────────────────────────────
CREATE TABLE IF NOT EXISTS hierarchy.positions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  code                  VARCHAR(64) NOT NULL,
  office_id             UUID NOT NULL REFERENCES hierarchy.offices(id),
  designation           VARCHAR(160) NOT NULL,   -- Collector | SDM | Tehsildar | SP | DSP | SHO | BDO | ...
  grade                 VARCHAR(48),
  financial_powers_minor BIGINT NOT NULL DEFAULT 0,  -- sanction ceiling in paise
  magisterial           BOOLEAN NOT NULL DEFAULT false,
  is_sanctioned         BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID NOT NULL,
  updated_by            UUID NOT NULL,
  version               INT NOT NULL DEFAULT 1,
  CONSTRAINT positions_tenant_code_uniq UNIQUE (tenant_id, code),
  CONSTRAINT positions_fin_nonneg CHECK (financial_powers_minor >= 0)
);
CREATE INDEX IF NOT EXISTS idx_positions_tenant_office ON hierarchy.positions(tenant_id, office_id);

-- ── postings (who holds which position at which office, effective-dated) ──────
CREATE TABLE IF NOT EXISTS hierarchy.postings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  employee_id    UUID NOT NULL,
  position_id    UUID NOT NULL REFERENCES hierarchy.positions(id),
  office_id      UUID NOT NULL REFERENCES hierarchy.offices(id),
  charge_type    VARCHAR(24) NOT NULL DEFAULT 'substantive',  -- substantive|acting|additional|in_charge
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  order_ref      VARCHAR(120),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID NOT NULL,
  updated_by     UUID NOT NULL,
  version        INT NOT NULL DEFAULT 1,
  CONSTRAINT postings_charge_chk CHECK (charge_type IN ('substantive','acting','additional','in_charge')),
  CONSTRAINT postings_dates_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_postings_tenant_employee ON hierarchy.postings(tenant_id, employee_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_postings_tenant_position ON hierarchy.postings(tenant_id, position_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_postings_tenant_office   ON hierarchy.postings(tenant_id, office_id)   WHERE is_active;
-- One substantive holder per position at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_postings_substantive
  ON hierarchy.postings(tenant_id, position_id)
  WHERE is_active AND charge_type = 'substantive';

-- ── jurisdiction.jurisdictions (office -> territory) ─────────────────────────
CREATE TABLE IF NOT EXISTS jurisdiction.jurisdictions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  office_id        UUID NOT NULL REFERENCES hierarchy.offices(id),
  unit_id          UUID NOT NULL REFERENCES hierarchy.administrative_units(id),
  level            VARCHAR(24) NOT NULL,
  hierarchy_domain VARCHAR(16) NOT NULL DEFAULT 'civil',
  jurisdiction_type VARCHAR(24) NOT NULL DEFAULT 'territorial',  -- territorial|functional
  is_primary       BOOLEAN NOT NULL DEFAULT false,
  effective_from   DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to     DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID NOT NULL,
  updated_by       UUID NOT NULL,
  version          INT NOT NULL DEFAULT 1,
  CONSTRAINT juris_domain_chk CHECK (hierarchy_domain IN ('civil','revenue','rural','urban','police')),
  CONSTRAINT juris_dates_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_juris_tenant_office ON jurisdiction.jurisdictions(tenant_id, office_id) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_juris_tenant_unit   ON jurisdiction.jurisdictions(tenant_id, unit_id)   WHERE effective_to IS NULL;

-- ── RLS: fail-closed tenant isolation + FORCE on every tenant-scoped table ────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hierarchy.administrative_units',
    'hierarchy.offices',
    'hierarchy.positions',
    'hierarchy.postings',
    'jurisdiction.jurisdictions'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %s', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_policy ON %s USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO location_svc', t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA hierarchy, jurisdiction TO location_svc;
