-- 0061_gratuity_rule_config_arrears_approval.sql
--
-- fin-payroll-02 (finish wave). Additive + idempotent.
--
-- 1) GAP-PAYROLL-STATUTORY-GRATUITY-01/04: per-tenant (edition) gratuity rule
--    set. CLAUDE.md: editions are entitlements, not code forks, but the
--    gratuity formula was hard-coded to the Payment of Gratuity Act, 1972.
--    A tenant row selects the rule set:
--      pog_act  : Payment of Gratuity Act, 1972 s.4(2) (PSU / small office /
--                 private) -- 15/26 x emoluments x completed years, 5-year
--                 floor, statutory ceiling (Rs 20,00,000).
--      ccs_dcrg : CCS (Pension) Rules, 2021 r.50 (Govt Department) -- 1/4 x
--                 emoluments x completed six-monthly periods, max 16.5 x
--                 emoluments, ceiling (Rs 25,00,000 from 1 Jan 2024).
--    Effective-dated; resolved by the latest row on/before the separation
--    date, else the code default (pog_act, today s behaviour). NOTHING seeded.
--    The ceiling is a column so a notified change is a new row, not a deploy.
--
-- 2) GAP-PAYROLL-ARREARS-03: maker-checker for manual arrears. Decision
--    columns on payroll_arrears, and a per-tenant switch on payroll_settings
--    (default TRUE): when ON the payroll run pays only APPROVED arrears
--    (revision-generated arrears are inserted already approved).
--
-- Rollback:
--   DROP TABLE IF EXISTS statutory.gratuity_rule_config;
--   ALTER TABLE payroll.payroll_arrears DROP COLUMN IF EXISTS decided_by, DROP COLUMN IF EXISTS decided_at, DROP COLUMN IF EXISTS decision_note;
--   ALTER TABLE payroll.payroll_settings DROP COLUMN IF EXISTS arrears_approval_required;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS statutory.gratuity_rule_config (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  effective_from     date        NOT NULL,
  rule_set           varchar(16) NOT NULL,
  min_service_years  integer     NOT NULL DEFAULT 5,
  ceiling_minor      bigint      NOT NULL,
  change_reason      text        NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  CONSTRAINT ux_gratuity_rule_config_tenant_effective UNIQUE (tenant_id, effective_from)
);

DO $$ BEGIN
  ALTER TABLE statutory.gratuity_rule_config ADD CONSTRAINT gratuity_rule_config_values_chk
    CHECK (rule_set IN ('pog_act', 'ccs_dcrg')
       AND min_service_years BETWEEN 0 AND 40
       AND ceiling_minor BETWEEN 0 AND 100000000000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_gratuity_rule_config_tenant_effective
  ON statutory.gratuity_rule_config (tenant_id, effective_from DESC);

ALTER TABLE statutory.gratuity_rule_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.gratuity_rule_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON statutory.gratuity_rule_config;
CREATE POLICY tenant_isolation_policy ON statutory.gratuity_rule_config
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- GRANDFATHERING (first application only). The approval gate is ON by default,
-- so a manual arrear that was already pending before this migration would
-- silently stop being paid. Those pre-existing rows are approved once, by the
-- migration itself (decided_by stays NULL: no human decided), so the next run
-- still pays them; every manual arrear created AFTER this needs a checker.
-- The decided_at column does not exist before this migration, so its absence
-- is the "first application" test: a re-run never approves a post-gate arrear.
-- payroll_arrears is FORCE RLS and a migration has no tenant GUC, so RLS is
-- lifted for the one statement and forced again inside the same DO block
-- (atomic: a failure rolls the whole block back). No settings row is seeded.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'payroll' AND table_name = 'payroll_arrears' AND column_name = 'decided_at'
  ) THEN
    ALTER TABLE payroll.payroll_arrears
      ADD COLUMN IF NOT EXISTS decided_by    uuid,
      ADD COLUMN IF NOT EXISTS decided_at    timestamptz,
      ADD COLUMN IF NOT EXISTS decision_note varchar(512);
    ALTER TABLE payroll.payroll_arrears NO FORCE ROW LEVEL SECURITY;
    -- grandfather:begin
    UPDATE payroll.payroll_arrears SET status = 'approved', decided_at = now(), decision_note = 'grandfathered by migration 0061' WHERE status = 'pending' AND source = 'manual' AND run_id IS NULL;
    -- grandfather:end
    ALTER TABLE payroll.payroll_arrears FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

ALTER TABLE payroll.payroll_arrears
  ADD COLUMN IF NOT EXISTS decided_by    uuid,
  ADD COLUMN IF NOT EXISTS decided_at    timestamptz,
  ADD COLUMN IF NOT EXISTS decision_note varchar(512);

ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS arrears_approval_required boolean NOT NULL DEFAULT true;
