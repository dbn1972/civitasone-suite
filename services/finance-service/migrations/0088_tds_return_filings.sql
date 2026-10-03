-- 0088_tds_return_filings.sql
-- GAP-FINANCE-STATUTORY-TDS-RETURNS-04 (remainder): a register of quarterly TDS
-- return filings (Form 26Q by FY + quarter) recording the acknowledgement
-- (provisional receipt) number, the filing date, the statutory due date and who
-- recorded it. The in-app record is made AFTER the return is filed on the
-- external e-filing portal; nothing here talks to TRACES.
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP TABLE gl.finance_tds_return_filings;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS gl.finance_tds_return_filings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  fy            varchar(7) NOT NULL,
  quarter       varchar(2) NOT NULL,
  form_type     varchar(8) NOT NULL DEFAULT '26Q',
  due_date      date NOT NULL,
  status        varchar(16) NOT NULL DEFAULT 'filed',
  ack_no        varchar(32) NOT NULL,
  filed_on      date NOT NULL,
  filed_by      uuid NOT NULL,
  filed_at      timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_tds_return_filings_quarter_chk CHECK (quarter IN ('Q1','Q2','Q3','Q4')),
  CONSTRAINT finance_tds_return_filings_status_chk CHECK (status IN ('filed')),
  CONSTRAINT finance_tds_return_filings_fy_chk CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT finance_tds_return_filings_uq UNIQUE (tenant_id, fy, quarter, form_type)
);

CREATE INDEX IF NOT EXISTS idx_finance_tds_return_filings_tenant_fy
  ON gl.finance_tds_return_filings (tenant_id, fy);

ALTER TABLE gl.finance_tds_return_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_tds_return_filings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_tds_return_filings;
CREATE POLICY tenant_isolation_policy ON gl.finance_tds_return_filings
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());
