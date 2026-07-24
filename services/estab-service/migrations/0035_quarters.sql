-- 0035: Quarters module — residential quarters allotment, licence-fee,
-- vacation/handover for government establishments (SVC-058).
--
-- New PG schema: quarters
-- New tables:
--   quarters.estab_quarters           — inventory of quarter units
--   quarters.estab_quarter_allotments — waitlist→allot→occupy→vacate workflow
--   quarters.estab_licence_fee_rates  — effective-dated monthly licence-fee schedule
--   quarters.estab_overstay_penalties — penalty records for overstay beyond vacation date
--
-- Additive + idempotent (IF NOT EXISTS throughout).
-- Money columns: bigint paise. Timestamps: timestamptz.
--
-- Rollback: DROP SCHEMA quarters CASCADE;
--           (destroys all 4 tables — use only if never populated)

SET lock_timeout = '5s';

-- ─── Schema ──────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS quarters;

-- ─── (a) Quarter inventory ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quarters.estab_quarters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  quarter_no      TEXT NOT NULL,
  quarter_type    VARCHAR(16) NOT NULL DEFAULT 'type_iv',
  category        VARCHAR(32) NOT NULL DEFAULT 'general',
  address         TEXT,
  locality        TEXT,
  carpet_area_sqft INTEGER,
  status          VARCHAR(24) NOT NULL DEFAULT 'vacant',
  condition       VARCHAR(24) NOT NULL DEFAULT 'good',
  org_unit        VARCHAR(64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  version         INT NOT NULL DEFAULT 1
);

ALTER TABLE quarters.estab_quarters DROP CONSTRAINT IF EXISTS chk_quarter_status;
ALTER TABLE quarters.estab_quarters
  ADD CONSTRAINT chk_quarter_status CHECK (status IN ('vacant','occupied','under_maintenance','condemned'));

ALTER TABLE quarters.estab_quarters DROP CONSTRAINT IF EXISTS chk_quarter_condition;
ALTER TABLE quarters.estab_quarters
  ADD CONSTRAINT chk_quarter_condition CHECK (condition IN ('good','fair','poor','condemned'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_estab_quarters_tenant_no
  ON quarters.estab_quarters (tenant_id, quarter_no);

CREATE INDEX IF NOT EXISTS idx_estab_quarters_tenant_status
  ON quarters.estab_quarters (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_estab_quarters_tenant_type
  ON quarters.estab_quarters (tenant_id, quarter_type);

-- ─── (b) Allotment workflow ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quarters.estab_quarter_allotments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  quarter_id          UUID NOT NULL,
  employee_ref        UUID NOT NULL,
  designation         VARCHAR(120),
  pay_level           VARCHAR(16),
  eligibility_score   INT NOT NULL DEFAULT 0,
  applied_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  waitlist_position   INT,
  status              VARCHAR(24) NOT NULL DEFAULT 'applied',
  allotted_at         TIMESTAMPTZ,
  allotted_by         UUID,
  occupied_at         TIMESTAMPTZ,
  vacation_notice_at  TIMESTAMPTZ,
  vacation_due_date   DATE,
  vacated_at          TIMESTAMPTZ,
  handover_notes      TEXT,
  cancelled_at        TIMESTAMPTZ,
  cancel_reason       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID NOT NULL,
  updated_by          UUID NOT NULL,
  version             INT NOT NULL DEFAULT 1
);

ALTER TABLE quarters.estab_quarter_allotments DROP CONSTRAINT IF EXISTS chk_allotment_status;
ALTER TABLE quarters.estab_quarter_allotments
  ADD CONSTRAINT chk_allotment_status CHECK (
    status IN ('applied','waitlisted','allotted','occupied','vacation_notice','vacated','cancelled')
  );

CREATE INDEX IF NOT EXISTS idx_estab_allotment_tenant_quarter
  ON quarters.estab_quarter_allotments (tenant_id, quarter_id);

CREATE INDEX IF NOT EXISTS idx_estab_allotment_tenant_employee
  ON quarters.estab_quarter_allotments (tenant_id, employee_ref);

CREATE INDEX IF NOT EXISTS idx_estab_allotment_tenant_status
  ON quarters.estab_quarter_allotments (tenant_id, status);

-- ─── (c) Licence-fee rate schedule ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quarters.estab_licence_fee_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  quarter_type    VARCHAR(16) NOT NULL,
  pay_level       VARCHAR(16) NOT NULL,
  monthly_minor   BIGINT NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'INR',
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  version         INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_estab_licence_fee_tenant_type
  ON quarters.estab_licence_fee_rates (tenant_id, quarter_type, pay_level);

CREATE INDEX IF NOT EXISTS idx_estab_licence_fee_effective
  ON quarters.estab_licence_fee_rates (tenant_id, effective_from, effective_to);

-- ─── (d) Overstay penalties ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quarters.estab_overstay_penalties (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  allotment_id    UUID NOT NULL,
  employee_ref    UUID NOT NULL,
  penalty_days    INT NOT NULL,
  daily_rate_minor BIGINT NOT NULL,
  multiplier      NUMERIC(4,2) NOT NULL DEFAULT 2.0,
  total_minor     BIGINT NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'INR',
  status          VARCHAR(24) NOT NULL DEFAULT 'pending',
  recovered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  version         INT NOT NULL DEFAULT 1
);

ALTER TABLE quarters.estab_overstay_penalties DROP CONSTRAINT IF EXISTS chk_penalty_status;
ALTER TABLE quarters.estab_overstay_penalties
  ADD CONSTRAINT chk_penalty_status CHECK (status IN ('pending','recovered','waived'));

CREATE INDEX IF NOT EXISTS idx_estab_overstay_tenant_allotment
  ON quarters.estab_overstay_penalties (tenant_id, allotment_id);

CREATE INDEX IF NOT EXISTS idx_estab_overstay_tenant_status
  ON quarters.estab_overstay_penalties (tenant_id, status);

-- ─── RLS policies ───────────────────────────────────────────────────────────

ALTER TABLE quarters.estab_quarters ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarters.estab_quarter_allotments ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarters.estab_licence_fee_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarters.estab_overstay_penalties ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rls_quarters_tenant' AND tablename = 'estab_quarters') THEN
    EXECUTE 'CREATE POLICY rls_quarters_tenant ON quarters.estab_quarters USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rls_allotments_tenant' AND tablename = 'estab_quarter_allotments') THEN
    EXECUTE 'CREATE POLICY rls_allotments_tenant ON quarters.estab_quarter_allotments USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rls_licence_fee_tenant' AND tablename = 'estab_licence_fee_rates') THEN
    EXECUTE 'CREATE POLICY rls_licence_fee_tenant ON quarters.estab_licence_fee_rates USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rls_overstay_tenant' AND tablename = 'estab_overstay_penalties') THEN
    EXECUTE 'CREATE POLICY rls_overstay_tenant ON quarters.estab_overstay_penalties USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)';
  END IF;
END $$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA quarters TO estab_svc;
