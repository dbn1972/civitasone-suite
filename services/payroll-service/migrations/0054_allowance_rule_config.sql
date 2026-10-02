-- 0054_allowance_rule_config.sql
--
-- PAY-PROFILES (PR2): effective-dated, tenant-overridable ALLOWANCE RULES:
--
--  * 7th CPC HRA minimum floor per city class (HRA = max(slab %, floor)),
--    applied to government-scale HRA (govt_scale + both deputation profiles)
--    in the payslip, the Sec 10(13A) exemption and retro arrears;
--  * deputation (duty) allowance rule for Option A deputationists:
--    % of basic + rupee cap, separately for same-station and other-station.
--
-- A SEPARATE table from statutory.statutory_config on purpose: that table is
-- resolved ROW-level (a tenant's latest row wins whole), so adding these
-- fields there would force every tenant that sets an HRA floor to also pin
-- a private copy of the PF/ESI/80C values. Here every column is NULLABLE and
-- resolved FIELD-level (tenant's latest non-null value on/before the month,
-- else the platform default's, else "none"), so tenants override only what
-- they mean to.
--
-- NOTHING IS SEEDED. The go-live of the HRA floor changes live pay, so it is
-- an explicit, reviewed operations step -- never a date derived from when
-- this migration happened to run: after reviewing
-- `pnpm report:hra-floor-impact`, ops set the platform default with an
-- explicit effective month via
--   pnpm payroll:set-hra-floor --effective YYYY-MM --x 540000 --y 360000 --z 180000 --reason "..." --actor <uuid>
-- (X ₹5,400 / Y ₹3,600 / Z ₹1,800 per the decision), and a tenant can move
-- or disable it (0) with its own row through POST /v1/payroll/allowance-rules.
-- Until a floor is configured, HRA is the plain slab (today's behaviour) and
-- the run preflight / run audit warn that no floor is configured. The
-- deputation-allowance rule is likewise tenant-configured (the API pre-fills
-- 5%/₹4,500 and 10%/₹9,000 marked "VERIFY against current DoPT OM"); until
-- then the deputation order's fixed amount is paid.
--
-- Additive + idempotent.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS statutory.allowance_rule_config (
  id                                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                         uuid        NOT NULL,     -- '00000000-...-000000000000' = platform default
  effective_from                    date        NOT NULL,
  hra_floor_x_minor                 bigint,
  hra_floor_y_minor                 bigint,
  hra_floor_z_minor                 bigint,
  dep_allow_same_station_bps        integer,
  dep_allow_same_station_cap_minor  bigint,
  dep_allow_other_station_bps       integer,
  dep_allow_other_station_cap_minor bigint,
  change_reason                     text        NOT NULL,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  created_by                        uuid        NOT NULL,
  CONSTRAINT ux_allowance_rule_config_tenant_effective UNIQUE (tenant_id, effective_from)
);

DO $$ BEGIN
  ALTER TABLE statutory.allowance_rule_config ADD CONSTRAINT allowance_rule_config_month_start_chk
    CHECK (EXTRACT(DAY FROM effective_from) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE statutory.allowance_rule_config ADD CONSTRAINT allowance_rule_config_values_chk
    CHECK ((hra_floor_x_minor IS NULL OR hra_floor_x_minor BETWEEN 0 AND 100000000)
       AND (hra_floor_y_minor IS NULL OR hra_floor_y_minor BETWEEN 0 AND 100000000)
       AND (hra_floor_z_minor IS NULL OR hra_floor_z_minor BETWEEN 0 AND 100000000)
       AND (dep_allow_same_station_bps IS NULL OR dep_allow_same_station_bps BETWEEN 0 AND 10000)
       AND (dep_allow_other_station_bps IS NULL OR dep_allow_other_station_bps BETWEEN 0 AND 10000)
       AND (dep_allow_same_station_cap_minor IS NULL OR dep_allow_same_station_cap_minor BETWEEN 0 AND 100000000)
       AND (dep_allow_other_station_cap_minor IS NULL OR dep_allow_other_station_cap_minor BETWEEN 0 AND 100000000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- A deputation rule is a (%, cap) PAIR per station type: both or neither.
DO $$ BEGIN
  ALTER TABLE statutory.allowance_rule_config ADD CONSTRAINT allowance_rule_config_dep_pair_chk
    CHECK ((dep_allow_same_station_bps IS NULL) = (dep_allow_same_station_cap_minor IS NULL)
       AND (dep_allow_other_station_bps IS NULL) = (dep_allow_other_station_cap_minor IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_allowance_rule_config_tenant_effective
  ON statutory.allowance_rule_config (tenant_id, effective_from DESC);

ALTER TABLE statutory.allowance_rule_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.allowance_rule_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON statutory.allowance_rule_config;
CREATE POLICY tenant_isolation_policy ON statutory.allowance_rule_config
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
-- Every tenant can also READ the platform-default rows (mirrors 0038).
DROP POLICY IF EXISTS platform_default_read_policy ON statutory.allowance_rule_config;
CREATE POLICY platform_default_read_policy ON statutory.allowance_rule_config
  FOR SELECT
  USING (tenant_id = '00000000-0000-0000-0000-000000000000'::uuid);

