-- DOM-008: effective-dated, tenant-overridable statutory config for PF/ESI/EPS
-- and Chapter VI-A (80C/80D) caps. Before this migration, domain.ts hardcoded
-- PF 12% / wage cap ₹15,000 / EPS 8.33% capped ₹1,250 / ESI ₹21,000 threshold
-- at 0.75%/3.25%, and 80C/80D caps — changing any of these required a code
-- deploy, and the tenant-override percentage columns already sitting on
-- statutory.payroll_pf / payroll_gpf / payroll_nps (empContribPct etc.) were
-- written on every slip but never read back by the computation itself.
--
-- tenant_id uses this codebase's existing sentinel-zero-UUID platform-default
-- convention (see notification-service migrations 0003/0044/0045: real rows
-- use a real tenant_id, the platform default uses
-- '00000000-0000-0000-0000-000000000000', and an ADDITIVE permissive SELECT
-- policy grants every tenant read access to just the sentinel rows) rather
-- than a nullable tenant_id — a NULL tenant_id would never match
-- `tenant_id = payroll.current_tenant_id()` under FORCE ROW LEVEL SECURITY
-- and would be invisible to every tenant, same root cause as notification
-- migration 0045 fixed.
--
-- Effective-dating: `effective_from` + UNIQUE(tenant_id, effective_from).
-- domain.ts's resolveStatutoryConfig() (pure) picks the tenant's own latest
-- row on/before the payroll period, else the platform default's latest row
-- on/before it, else the literal DEFAULT_STATUTORY_CONFIG (belt-and-
-- suspenders; this seed guarantees a platform row always exists first).
--
-- The seeded platform-default row below is EXACTLY the value that was
-- hardcoded before this migration (verified against domain.ts:125-132,
-- 260-265 pre-fix) with effective_from '2000-01-01' so it applies to every
-- historical and current payroll period — no existing tenant's computed slip
-- changes as a result of this migration; only an explicit tenant override
-- (inserted after this migration) changes anything.
--
-- Rollback: DROP TABLE statutory.statutory_config;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS statutory.statutory_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,       -- '00000000-...-000000000000' = platform default
  effective_from        DATE NOT NULL,
  pf_rate_pct           INTEGER NOT NULL DEFAULT 12,        -- EPF employee AND employer rate, %
  pf_wage_cap_minor     BIGINT NOT NULL DEFAULT 1500000,    -- ₹15,000, paise
  eps_rate_bps          INTEGER NOT NULL DEFAULT 833,       -- 8.33%, basis points
  eps_cap_minor         BIGINT NOT NULL DEFAULT 125000,     -- ₹1,250, paise
  esi_wage_cap_minor    BIGINT NOT NULL DEFAULT 2100000,    -- ₹21,000, paise
  esi_employee_rate_bps INTEGER NOT NULL DEFAULT 75,        -- 0.75%, basis points
  esi_employer_rate_bps INTEGER NOT NULL DEFAULT 325,       -- 3.25%, basis points
  sec80c_cap_minor      BIGINT NOT NULL DEFAULT 15000000,   -- ₹1,50,000, paise
  sec80d_cap_minor      BIGINT NOT NULL DEFAULT 7500000,    -- ₹75,000, paise
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID NOT NULL,
  CONSTRAINT ux_statutory_config_tenant_effective UNIQUE (tenant_id, effective_from)
);

CREATE INDEX IF NOT EXISTS ix_statutory_config_tenant_effective
  ON statutory.statutory_config (tenant_id, effective_from DESC);

ALTER TABLE statutory.statutory_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.statutory_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON statutory.statutory_config;
CREATE POLICY tenant_isolation_policy ON statutory.statutory_config
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- Additive, SELECT-only: every tenant session can also see the sentinel
-- platform-default rows (mirrors notification-service migration 0045
-- exactly). Postgres ORs together permissive policies for the same command,
-- so a real tenant's own override rows are still governed solely by the
-- strict policy above for INSERT/UPDATE/DELETE — only SELECT gains the
-- platform-wide row visibility.
DROP POLICY IF EXISTS platform_default_read_policy ON statutory.statutory_config;
CREATE POLICY platform_default_read_policy ON statutory.statutory_config
  FOR SELECT
  USING (tenant_id = '00000000-0000-0000-0000-000000000000'::uuid);

-- Seed the platform default = the exact pre-DOM-008 hardcoded values, backed
-- to the earliest date any payroll period could reasonably use so it always
-- resolves for both historical and future runs unless a tenant overrides it.
--
-- The strict tenant_isolation_policy's WITH CHECK (tenant_id =
-- payroll.current_tenant_id()) applies to this INSERT too — civitas_admin
-- (the migration-running role) is deliberately NOSUPERUSER NOBYPASSRLS (see
-- migration 0037's comment) and this table is FORCE ROW LEVEL SECURITY, so a
-- plain INSERT with no app.tenant_id GUC set fails WITH CHECK for every
-- tenant_id, sentinel included. Set the GUC to the sentinel value for the
-- duration of this one transaction so the row satisfies its own policy
-- naturally, exactly like the app does per-request for a real tenant — no
-- RLS bypass, and correctly idempotent on any re-run regardless of whether
-- RLS was already enabled by a previous run of this file.
BEGIN;
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000000';
INSERT INTO statutory.statutory_config
  (tenant_id, effective_from, pf_rate_pct, pf_wage_cap_minor, eps_rate_bps, eps_cap_minor,
   esi_wage_cap_minor, esi_employee_rate_bps, esi_employer_rate_bps, sec80c_cap_minor, sec80d_cap_minor,
   created_by)
VALUES
  ('00000000-0000-0000-0000-000000000000', '2000-01-01',
   12, 1500000, 833, 125000, 2100000, 75, 325, 15000000, 7500000,
   '00000000-0000-0000-0000-000000000099')
ON CONFLICT (tenant_id, effective_from) DO NOTHING;
COMMIT;
