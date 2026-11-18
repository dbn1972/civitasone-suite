-- 0189_psu_dividends.sql
-- PSU v1 slice C (2/2): the dividend register -- declaration -> payment. A declaration posts Dr dividends-declared (equity/reserve
-- appropriation head) / Cr dividend payable; payment posts Dr dividend payable / Cr bank. The row snapshots the equity-share count
-- and the government's share at declaration (shares x per-share rate), so the amount remittable to the Government is derivable.
-- ADDITIVE and dormant (routes gated on coa_template = commercial AND govt_owned). The journals go through the existing outbox ->
-- finance.gl.post path with a deterministic id (declared_journal_id / paid_journal_id), so a redelivery cannot double-post.
-- Table spec: tenant_id NOT NULL; ENABLE + FORCE RLS; tenant policy USING + WITH CHECK; UNIQUE(tenant_id,id); audit columns +
-- version; tenant-first index. DIPAM minimum-dividend and dividend-TDS rules are CA-VERIFY config, not stored here.
-- Rollback (only while empty): DROP TABLE gl.psu_dividends;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS gl.psu_dividends (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid         NOT NULL,
  fy_code             varchar(7)   NOT NULL,
  dividend_type       varchar(8)   NOT NULL,
  declared_on         date         NOT NULL,
  resolution_ref      text         NOT NULL,
  per_share_minor     bigint       NOT NULL,
  equity_shares       bigint       NOT NULL,
  govt_shares         bigint       NOT NULL DEFAULT 0,
  amount_minor        bigint       NOT NULL,
  govt_amount_minor   bigint       NOT NULL DEFAULT 0,
  status              varchar(10)  NOT NULL DEFAULT 'declared',
  declared_journal_id uuid         NOT NULL,
  paid_on             date,
  paid_journal_id     uuid,
  created_by          uuid         NOT NULL,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_by          uuid         NOT NULL,
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  version             integer      NOT NULL DEFAULT 1,
  CONSTRAINT psu_dividends_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT psu_dividends_declaration_key  UNIQUE (tenant_id, fy_code, dividend_type, declared_on),
  CONSTRAINT psu_dividends_fy_check      CHECK (fy_code ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT psu_dividends_type_check    CHECK (dividend_type IN ('interim', 'final')),
  CONSTRAINT psu_dividends_status_check  CHECK (status IN ('declared', 'paid')),
  CONSTRAINT psu_dividends_resolution_check CHECK (length(btrim(resolution_ref)) > 0),
  CONSTRAINT psu_dividends_amount_check  CHECK (per_share_minor > 0 AND equity_shares > 0 AND amount_minor > 0
                                                AND govt_shares >= 0 AND govt_shares <= equity_shares
                                                AND govt_amount_minor >= 0 AND govt_amount_minor <= amount_minor
                                                AND amount_minor = per_share_minor * equity_shares),
  CONSTRAINT psu_dividends_paid_check    CHECK ((status = 'paid') = (paid_on IS NOT NULL AND paid_journal_id IS NOT NULL)),
  CONSTRAINT psu_dividends_paid_after_declared CHECK (paid_on IS NULL OR paid_on >= declared_on)
);
CREATE INDEX IF NOT EXISTS idx_psu_dividends_tenant_fy ON gl.psu_dividends (tenant_id, fy_code, declared_on);

ALTER TABLE gl.psu_dividends ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.psu_dividends FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.psu_dividends;
CREATE POLICY tenant_isolation_policy ON gl.psu_dividends
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_svc') THEN
    GRANT SELECT, INSERT, UPDATE ON gl.psu_dividends TO finance_svc;
  END IF;
END
$$;
