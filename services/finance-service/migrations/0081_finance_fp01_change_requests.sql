-- Migration 0081 (fp-finance-01): per-tenant finance settings + maker-checker
-- change requests.
--
-- GAP-FINANCE-FISCAL-YEARS-01/-02, GAP-FINANCE-OPENING-BALANCES-01,
-- GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-01: three ledger-shaping writes (activate a
-- fiscal year, seed opening balances, change a PFMS HoA code) used to take
-- effect the moment one officer submitted them. With the second-approver
-- setting ON (the default) each now lands here as a `pending` request that a
-- DIFFERENT officer approves or rejects; the approval applies the original
-- change in the same transaction.
--
-- Idempotent: every statement is IF NOT EXISTS / DROP-then-CREATE.

CREATE TABLE IF NOT EXISTS gl.finance_settings (
  tenant_id                          uuid PRIMARY KEY,
  -- Second approver (maker != checker) for FY activation, opening balances and
  -- HoA-code changes, and for UC verification. Defaults ON.
  maker_checker_enabled              boolean NOT NULL DEFAULT true,
  -- Refuse FY activation while any month of the outgoing year is not
  -- hard-closed.
  block_fy_activation_open_periods   boolean NOT NULL DEFAULT true,
  -- Refuse FY activation when the target year has no opening balances (only
  -- when an outgoing year exists). Default OFF: a tenant with a genuinely nil
  -- opening position must not be locked out.
  require_opening_balances_for_activation boolean NOT NULL DEFAULT false,
  -- A new fiscal year is created as `draft` while another year is active, so
  -- creating next year early never switches the posting year.
  fy_create_as_draft                 boolean NOT NULL DEFAULT true,
  -- GL heads the debt register posts to. NO defaults: until all three are set,
  -- debt create / instalment payment return 409 GL_HEADS_NOT_CONFIGURED.
  debt_loan_liability_head_id        uuid,
  debt_interest_expense_head_id      uuid,
  debt_bank_head_id                  uuid,
  updated_by                         uuid NOT NULL,
  updated_at                         timestamptz NOT NULL DEFAULT now(),
  version                            integer NOT NULL DEFAULT 1
);

ALTER TABLE gl.finance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_settings;
CREATE POLICY tenant_isolation_policy ON gl.finance_settings
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

CREATE TABLE IF NOT EXISTS gl.finance_change_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  kind           varchar(32) NOT NULL,
  -- natural key of the thing being changed (FY code, head id, FY code for an
  -- opening-balance batch); at most one PENDING request per (kind, subject).
  subject_key    text NOT NULL,
  payload        jsonb NOT NULL,
  reason         text NOT NULL,
  status         varchar(16) NOT NULL DEFAULT 'pending',
  requested_by   uuid NOT NULL,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT finance_change_requests_kind_check
    CHECK (kind IN ('fiscal_year_activate', 'opening_balances_enter', 'hoa_change', 'settings_relax')),
  CONSTRAINT finance_change_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT finance_change_requests_decision_check
    CHECK ((status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
        OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_change_requests_pending
  ON gl.finance_change_requests (tenant_id, kind, subject_key) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_finance_change_requests_tenant_status
  ON gl.finance_change_requests (tenant_id, status, requested_at DESC);

ALTER TABLE gl.finance_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_change_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_change_requests;
CREATE POLICY tenant_isolation_policy ON gl.finance_change_requests
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- Re-runnable on a database that already has the tables: widen the kind CHECK and add the GL-head columns.
ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS debt_loan_liability_head_id uuid;
ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS debt_interest_expense_head_id uuid;
ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS debt_bank_head_id uuid;
ALTER TABLE gl.finance_change_requests DROP CONSTRAINT IF EXISTS finance_change_requests_kind_check;
ALTER TABLE gl.finance_change_requests ADD CONSTRAINT finance_change_requests_kind_check
  CHECK (kind IN ('fiscal_year_activate', 'opening_balances_enter', 'hoa_change', 'settings_relax'));

-- DB backstop for "one active fiscal year per tenant" (the app also serialises on an advisory lock).
-- Refuses to create the index over existing duplicates, naming them.
DO $$
DECLARE dup text;
BEGIN
  SELECT string_agg(tenant_id::text || ' (' || n || ' active)', ', ') INTO dup
  FROM (SELECT tenant_id, count(*) AS n FROM gl.finance_fiscal_years WHERE status = 'active' GROUP BY tenant_id HAVING count(*) > 1) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'tenants with more than one active fiscal year, fix before applying: %', dup;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_fiscal_years_one_active
  ON gl.finance_fiscal_years (tenant_id) WHERE status = 'active';
