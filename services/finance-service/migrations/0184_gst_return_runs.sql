-- 0184_gst_return_runs.sql
-- MSME commercial M4 (GSTR-1 / GSTR-3B prepare + JSON export): two NEW tenant tables in the gl schema. billing's gstn/ (platform
-- SaaS returns) is untouched; these are the TENANT's own returns built from ar.sales_invoices + gl.finance_gst_ledger.
--   gl.gst_return_settings  one row per tenant: monthly | quarterly (QRMP) election. Eligibility (previous-FY turnover <= the
--                           CA-VERIFY QRMP ceiling) is checked in code at election time.
--   gl.gst_return_runs      an immutable PREPARED snapshot for one tax period (GSTR-1 JSON + GSTR-3B JSON + the GSTR-1<->3B
--                           reconciliation + warnings), so it can be re-exported byte-for-byte. A re-run for the same period is a
--                           new run_no (history is kept); the highest run_no is current. No filing state: live GSTN filing is v2.
-- schema_version pins the JSON adapter used (CA-VERIFY: no official public schema; see gst-returns/config.ts).
-- Rollback (only while empty): DROP TABLE gl.gst_return_runs, gl.gst_return_settings; DROP FUNCTION gl.guard_gst_return_run_immutable().

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS gl.gst_return_settings (
  tenant_id        uuid        PRIMARY KEY,
  filing_frequency varchar(10) NOT NULL DEFAULT 'monthly',
  updated_by       uuid        NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1,
  CONSTRAINT gst_return_settings_freq_check CHECK (filing_frequency IN ('monthly', 'quarterly'))
);

CREATE TABLE IF NOT EXISTS gl.gst_return_runs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  kind           varchar(10) NOT NULL,
  frequency      varchar(10) NOT NULL,
  period_key     varchar(7)  NOT NULL,
  from_date      date        NOT NULL,
  to_date        date        NOT NULL,
  run_no         integer     NOT NULL,
  schema_version varchar(24) NOT NULL,
  gstin          varchar(15) NOT NULL,
  gstr1_json     jsonb       NOT NULL,
  gstr3b_json    jsonb,
  summary        jsonb       NOT NULL,
  reconciliation jsonb       NOT NULL,
  warnings       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_by     uuid        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gst_return_runs_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT gst_return_runs_period_key UNIQUE (tenant_id, kind, frequency, period_key, run_no),
  CONSTRAINT gst_return_runs_kind_check CHECK (kind IN ('periodic', 'iff')),
  CONSTRAINT gst_return_runs_freq_check CHECK (frequency IN ('monthly', 'quarterly')),
  CONSTRAINT gst_return_runs_period_fmt CHECK (period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT gst_return_runs_range_check CHECK (to_date >= from_date),
  CONSTRAINT gst_return_runs_runno_check CHECK (run_no >= 1)
);
CREATE INDEX IF NOT EXISTS idx_gst_return_runs_period ON gl.gst_return_runs (tenant_id, kind, period_key, run_no DESC);

ALTER TABLE gl.gst_return_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.gst_return_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE gl.gst_return_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.gst_return_runs     FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.gst_return_settings;
CREATE POLICY tenant_isolation_policy ON gl.gst_return_settings
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.gst_return_runs;
CREATE POLICY tenant_isolation_policy ON gl.gst_return_runs
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_svc') THEN
    GRANT SELECT, INSERT, UPDATE ON gl.gst_return_settings TO finance_svc;
    GRANT SELECT, INSERT         ON gl.gst_return_runs     TO finance_svc;  -- append-only snapshots
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION gl.guard_gst_return_run_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'GST_RETURN_RUN_IMMUTABLE: a prepared return snapshot cannot be changed; prepare a new run' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_gst_return_run_immutable ON gl.gst_return_runs;
CREATE TRIGGER trg_gst_return_run_immutable BEFORE UPDATE OR DELETE ON gl.gst_return_runs
  FOR EACH ROW EXECUTE FUNCTION gl.guard_gst_return_run_immutable();
