-- 0063_bonus_rule_config.sql
--
-- GAP-PAYROLL-BONUS-02: Payment of Bonus Act, 1965 parameters, per tenant,
-- effective-dated (a notified change is a new row, not a deploy):
--   wage_ceiling_minor      calculation ceiling on monthly wages (s.12: the
--                           higher of Rs 7,000 or the minimum wage);
--   eligibility_ceiling_minor  an employee drawing more than this per month is
--                           not entitled (s.2(13): Rs 21,000);
--   min_bonus_bps / max_bonus_bps  s.10 / s.11: 8.33% .. 20% of annual wages.
-- ALL columns are nullable: NULL = "not enforced" (today's behaviour, the
-- legacy bonus amounts stay byte-identical). NOTHING is seeded -- whether the
-- Act applies at all (Government departments are largely outside it, s.32)
-- and which minimum wage governs is the tenant's decision; the API returns
-- the statutory figures as VERIFY pre-fills only.
--
-- Rollback: DROP TABLE IF EXISTS statutory.bonus_rule_config;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS statutory.bonus_rule_config (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid        NOT NULL,
  effective_from            date        NOT NULL,
  wage_ceiling_minor        bigint,
  eligibility_ceiling_minor bigint,
  min_bonus_bps             integer,
  max_bonus_bps             integer,
  change_reason             text        NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid        NOT NULL,
  CONSTRAINT ux_bonus_rule_config_tenant_effective UNIQUE (tenant_id, effective_from)
);

DO $$ BEGIN
  ALTER TABLE statutory.bonus_rule_config ADD CONSTRAINT bonus_rule_config_values_chk
    CHECK ((wage_ceiling_minor IS NULL OR wage_ceiling_minor BETWEEN 0 AND 100000000000)
       AND (eligibility_ceiling_minor IS NULL OR eligibility_ceiling_minor BETWEEN 0 AND 100000000000)
       AND (min_bonus_bps IS NULL OR min_bonus_bps BETWEEN 0 AND 10000)
       AND (max_bonus_bps IS NULL OR max_bonus_bps BETWEEN 0 AND 10000)
       AND (min_bonus_bps IS NULL OR max_bonus_bps IS NULL OR min_bonus_bps <= max_bonus_bps));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_bonus_rule_config_tenant_effective
  ON statutory.bonus_rule_config (tenant_id, effective_from DESC);

ALTER TABLE statutory.bonus_rule_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.bonus_rule_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON statutory.bonus_rule_config;
CREATE POLICY tenant_isolation_policy ON statutory.bonus_rule_config
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
