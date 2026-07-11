-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 0009_court_sla.sql — §47 sla_timer disposal target
--   Adds court.cases.target_disposal_date (DATE): the computed target date by
--   which a case should be disposed, derived at registration from the tenant's
--   sla_timer config (disposal days by case type) + filing date. Advisory
--   metadata for SLA/overdue monitoring; existing rows stay NULL. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';
ALTER TABLE court.cases ADD COLUMN IF NOT EXISTS target_disposal_date date;
CREATE INDEX IF NOT EXISTS idx_cases_tenant_target_disposal
  ON court.cases (tenant_id, target_disposal_date);
