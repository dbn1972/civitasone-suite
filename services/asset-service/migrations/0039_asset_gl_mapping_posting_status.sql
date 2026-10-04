-- Migration: 0039_asset_gl_mapping_posting_status.sql
-- fp-assets-02: no hard-coded GL accounts anywhere in asset-service.
--   * asset_settings (the per-tenant GL mapping, RLS already FORCEd in 0037) gains the four heads the acquisition and
--     maintenance journals used to take from env defaults (1200 / 2070 / 2050 / 5300 / 2050):
--     grn_clearing, acquisition_offset, maintenance_expense, ap_control. (fixed_asset already exists.)
--   * assets and work orders carry the finance-side state of their journal. When the heads are not configured the record
--     is still saved and its journal is DEFERRED (awaiting_accounts); it posts once the accounts are set.
-- Idempotent. Rollback: DROP the columns / constraints / indexes added below.

SET lock_timeout = '5s';

ALTER TABLE enterprise.asset_settings ADD COLUMN IF NOT EXISTS grn_clearing_account_code varchar(16);
ALTER TABLE enterprise.asset_settings ADD COLUMN IF NOT EXISTS acquisition_offset_account_code varchar(16);
ALTER TABLE enterprise.asset_settings ADD COLUMN IF NOT EXISTS maintenance_expense_account_code varchar(16);
ALTER TABLE enterprise.asset_settings ADD COLUMN IF NOT EXISTS ap_control_account_code varchar(16);

-- Second approver (maker != checker) for GL head changes. Default ON; switching it OFF is itself a request a DIFFERENT
-- approver must approve (same pattern as the capitalisation approval in 0037 and finance's maker_checker_enabled).
ALTER TABLE enterprise.asset_settings ADD COLUMN IF NOT EXISTS gl_maker_checker boolean NOT NULL DEFAULT true;
-- The change a pending request carries (e.g. the GL heads to apply on approval).
ALTER TABLE enterprise.asset_setting_requests ADD COLUMN IF NOT EXISTS payload jsonb;

-- none (no journal needed / legacy) | awaiting_accounts (GL heads not configured: journal deferred) | pending (sent to
-- finance) | posted | failed (finance rejected it, e.g. an unknown account)
ALTER TABLE register.asset_assets ADD COLUMN IF NOT EXISTS gl_post_status varchar(20) NOT NULL DEFAULT 'none';
ALTER TABLE register.asset_assets ADD COLUMN IF NOT EXISTS gl_journal_id uuid;
ALTER TABLE register.asset_assets ADD COLUMN IF NOT EXISTS gl_post_error text;
ALTER TABLE register.asset_assets DROP CONSTRAINT IF EXISTS asset_assets_gl_post_status_check;
ALTER TABLE register.asset_assets ADD CONSTRAINT asset_assets_gl_post_status_check
  CHECK (gl_post_status IN ('none', 'awaiting_accounts', 'pending', 'posted', 'failed'));
CREATE INDEX IF NOT EXISTS idx_asset_assets_gl_open ON register.asset_assets (tenant_id, gl_post_status)
  WHERE gl_post_status IN ('awaiting_accounts', 'failed');
CREATE INDEX IF NOT EXISTS idx_asset_assets_gl_journal ON register.asset_assets (gl_journal_id) WHERE gl_journal_id IS NOT NULL;

ALTER TABLE maintenance.asset_work_orders ADD COLUMN IF NOT EXISTS gl_post_status varchar(20) NOT NULL DEFAULT 'none';
ALTER TABLE maintenance.asset_work_orders ADD COLUMN IF NOT EXISTS gl_journal_id uuid;
ALTER TABLE maintenance.asset_work_orders ADD COLUMN IF NOT EXISTS gl_post_error text;
ALTER TABLE maintenance.asset_work_orders DROP CONSTRAINT IF EXISTS asset_work_orders_gl_post_status_check;
ALTER TABLE maintenance.asset_work_orders ADD CONSTRAINT asset_work_orders_gl_post_status_check
  CHECK (gl_post_status IN ('none', 'awaiting_accounts', 'pending', 'posted', 'failed'));
CREATE INDEX IF NOT EXISTS idx_asset_work_orders_gl_open ON maintenance.asset_work_orders (tenant_id, gl_post_status)
  WHERE gl_post_status IN ('awaiting_accounts', 'failed');
CREATE INDEX IF NOT EXISTS idx_asset_work_orders_gl_journal ON maintenance.asset_work_orders (gl_journal_id) WHERE gl_journal_id IS NOT NULL;
