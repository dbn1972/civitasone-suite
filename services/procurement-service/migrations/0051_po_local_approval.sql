-- 0051_po_local_approval.sql
--
-- M10 (module-sale gap): procurement for a tenant WITHOUT the Finance module.
-- Today a purchase order above Rs 1,000 must cite a finance budget sanction and
-- is approved through a workflow task; without Finance neither can be done.
--
-- 1. po.po_approval_settings: one row per tenant. mode_override NULL (the
--    default, and what every existing tenant has: no row at all) means the
--    approval mode is derived from whether the tenant has Finance
--    ('finance_sanction' if it does, 'local' if not). 'finance_sanction' or
--    'local' forces it.
-- 2. po.po_approval_matrix: the tenant's local approval threshold matrix, one
--    row per value band. upto_minor is the band's inclusive upper limit in paise
--    (NULL = no limit, the last band); approver_roles are the procurement roles
--    that may approve a PO in the band. A tenant with no rows uses the built-in
--    default matrix (po-approval/matrix.ts). The service validates the whole
--    matrix (increasing limits, last band unbounded) before replacing it.
--
-- Additive and idempotent; nothing existing changes meaning.
-- Rollback:
--   DROP TABLE IF EXISTS po.po_approval_matrix;
--   DROP TABLE IF EXISTS po.po_approval_settings;
-- Affected services: procurement-service (po-approval module), web (PO approval settings)

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS po.po_approval_settings (
  tenant_id     uuid PRIMARY KEY,
  mode_override varchar(16),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid NOT NULL,
  CONSTRAINT po_approval_settings_mode_chk CHECK (mode_override IS NULL OR mode_override IN ('finance_sanction', 'local'))
);

CREATE TABLE IF NOT EXISTS po.po_approval_matrix (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  band_no        integer NOT NULL,
  upto_minor     bigint,
  approver_roles text[] NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid NOT NULL,
  CONSTRAINT po_approval_matrix_band_chk CHECK (band_no >= 1 AND band_no <= 10),
  CONSTRAINT po_approval_matrix_upto_chk CHECK (upto_minor IS NULL OR upto_minor > 0),
  CONSTRAINT po_approval_matrix_roles_chk CHECK (cardinality(approver_roles) >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_po_approval_matrix_band ON po.po_approval_matrix (tenant_id, band_no);

ALTER TABLE po.po_approval_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE po.po_approval_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON po.po_approval_settings;
CREATE POLICY tenant_isolation_policy ON po.po_approval_settings
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

ALTER TABLE po.po_approval_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE po.po_approval_matrix FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON po.po_approval_matrix;
CREATE POLICY tenant_isolation_policy ON po.po_approval_matrix
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'procurement_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON po.po_approval_settings, po.po_approval_matrix TO procurement_svc;
  END IF;
END $$;
