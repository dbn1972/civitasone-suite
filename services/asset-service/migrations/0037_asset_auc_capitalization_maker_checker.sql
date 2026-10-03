-- Migration: 0037_asset_auc_capitalization_maker_checker.sql
-- fp-assets-01 finish batch (GAP-ASSETS-PROJECTS-09). Additive + idempotent.
-- Capitalising an AUC (CWIP) project becomes a two-step maker != checker action
-- (per-tenant setting, default ON), carries a user-chosen capitalisation date
-- (both depreciation books start from it) and posts Dr Fixed asset / Cr CWIP.
-- Rollback: DROP TABLE IF EXISTS enterprise.asset_setting_requests; DROP TABLE IF EXISTS enterprise.asset_settings;
--           ALTER TABLE enterprise.project_auc DROP COLUMN IF EXISTS capitalization_date, cap_requested_by,
--             cap_requested_at, cap_reason, cap_decided_by, cap_decided_at, cap_reject_reason (one DROP each);
--           restore the 0035 project_auc_status_check.

SET lock_timeout = '5s';

ALTER TABLE enterprise.project_auc ADD COLUMN IF NOT EXISTS capitalization_date date;
ALTER TABLE enterprise.project_auc ADD COLUMN IF NOT EXISTS cap_requested_by uuid;
ALTER TABLE enterprise.project_auc ADD COLUMN IF NOT EXISTS cap_requested_at timestamptz;
ALTER TABLE enterprise.project_auc ADD COLUMN IF NOT EXISTS cap_reason text;
ALTER TABLE enterprise.project_auc ADD COLUMN IF NOT EXISTS cap_decided_by uuid;
ALTER TABLE enterprise.project_auc ADD COLUMN IF NOT EXISTS cap_decided_at timestamptz;
ALTER TABLE enterprise.project_auc ADD COLUMN IF NOT EXISTS cap_reject_reason text;

-- State of the capitalisation journal on the finance side: none (legacy rows), pending (journal sent),
-- posted (finance.gl.posted came back) or failed (finance rejected it, e.g. an unknown GL head).
ALTER TABLE enterprise.project_auc ADD COLUMN IF NOT EXISTS gl_post_status varchar(12) NOT NULL DEFAULT 'none';
ALTER TABLE enterprise.project_auc ADD COLUMN IF NOT EXISTS gl_journal_id uuid;
ALTER TABLE enterprise.project_auc ADD COLUMN IF NOT EXISTS gl_post_error text;
ALTER TABLE enterprise.project_auc DROP CONSTRAINT IF EXISTS project_auc_gl_post_status_check;
ALTER TABLE enterprise.project_auc ADD CONSTRAINT project_auc_gl_post_status_check
  CHECK (gl_post_status IN ('none', 'pending', 'posted', 'failed'));
CREATE INDEX IF NOT EXISTS idx_project_auc_gl_journal ON enterprise.project_auc (gl_journal_id) WHERE gl_journal_id IS NOT NULL;

ALTER TABLE enterprise.project_auc DROP CONSTRAINT IF EXISTS project_auc_status_check;
ALTER TABLE enterprise.project_auc
  ADD CONSTRAINT project_auc_status_check
  CHECK (status IN ('under_construction', 'pending_capitalization', 'capitalized', 'capitalised', 'cancelled'));

CREATE TABLE IF NOT EXISTS enterprise.asset_settings (
  tenant_id                uuid        PRIMARY KEY,
  capitalize_maker_checker boolean     NOT NULL DEFAULT true,
  -- GL heads. NO defaults anywhere: until a head is set, capitalisation / lease creation answer 409
  -- GL_HEADS_NOT_CONFIGURED. Each is validated against the finance chart of accounts when it is set.
  cwip_account_code        varchar(16),
  fixed_asset_account_code varchar(16),
  impairment_expense_account_code varchar(16),
  revaluation_reserve_account_code varchar(16),
  rou_account_code         varchar(16),
  lease_liability_account_code varchar(16),
  lease_offset_account_code varchar(16),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid        NOT NULL,
  version                  integer     NOT NULL DEFAULT 1
);

-- (idempotent re-runs on a table created before the head columns existed)
ALTER TABLE enterprise.asset_settings ADD COLUMN IF NOT EXISTS cwip_account_code varchar(16);
ALTER TABLE enterprise.asset_settings ADD COLUMN IF NOT EXISTS fixed_asset_account_code varchar(16);
ALTER TABLE enterprise.asset_settings ADD COLUMN IF NOT EXISTS impairment_expense_account_code varchar(16);
ALTER TABLE enterprise.asset_settings ADD COLUMN IF NOT EXISTS revaluation_reserve_account_code varchar(16);
ALTER TABLE enterprise.asset_settings ADD COLUMN IF NOT EXISTS rou_account_code varchar(16);
ALTER TABLE enterprise.asset_settings ADD COLUMN IF NOT EXISTS lease_liability_account_code varchar(16);
ALTER TABLE enterprise.asset_settings ADD COLUMN IF NOT EXISTS lease_offset_account_code varchar(16);

-- A switch that weakens a control (capitalisation maker-checker OFF) is a two-person request.
CREATE TABLE IF NOT EXISTS enterprise.asset_setting_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  kind            varchar(32) NOT NULL DEFAULT 'maker_checker_off',
  status          varchar(12) NOT NULL DEFAULT 'pending',
  reason          text        NOT NULL,
  requested_by    uuid        NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_reason text,
  CONSTRAINT asset_setting_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_setting_requests_one_pending
  ON enterprise.asset_setting_requests (tenant_id, kind) WHERE status = 'pending';

ALTER TABLE enterprise.asset_setting_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.asset_setting_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON enterprise.asset_setting_requests;
CREATE POLICY tenant_isolation_policy ON enterprise.asset_setting_requests
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

ALTER TABLE enterprise.asset_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.asset_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON enterprise.asset_settings;
CREATE POLICY tenant_isolation_policy ON enterprise.asset_settings
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());
