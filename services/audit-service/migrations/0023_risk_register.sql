-- SVC-099: enterprise risk & control register — controls, control tests,
--   incidents, mitigation plans, risk acceptance (maker-checker) and the
--   periodic review cycle. All in the existing `risk` schema.
-- Additive & idempotent. Every table: tenant_id + ENABLE/FORCE RLS +
--   tenant_isolation policy (events.current_tenant_id()), mirroring
--   0013_rls_full_tenant_isolation.sql.
-- Rollback: DROP TABLE risk.risk_reviews, risk.risk_acceptances,
--           risk.risk_mitigation_plans, risk.risk_incidents,
--           risk.risk_control_tests, risk.risk_controls;
-- Affected services: audit-service only.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS risk.risk_controls (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  risk_id       uuid        NOT NULL,
  control_code  text        NOT NULL,
  description   text        NOT NULL,
  control_type  varchar(16) NOT NULL DEFAULT 'preventive',
  owner_ref     text,
  effectiveness varchar(16) NOT NULL DEFAULT 'not_tested',
  status        varchar(16) NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        NOT NULL,
  updated_by    uuid        NOT NULL,
  version       integer     NOT NULL DEFAULT 1,
  CONSTRAINT risk_controls_type_check CHECK (control_type IN ('preventive','detective','corrective'))
);
CREATE INDEX IF NOT EXISTS idx_risk_controls_risk ON risk.risk_controls (tenant_id, risk_id);

CREATE TABLE IF NOT EXISTS risk.risk_control_tests (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL,
  control_id uuid        NOT NULL,
  result     varchar(16) NOT NULL,
  tested_by  text,
  test_date  date,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid        NOT NULL,
  CONSTRAINT risk_control_tests_result_check CHECK (result IN ('pass','fail','partial'))
);
CREATE INDEX IF NOT EXISTS idx_risk_control_tests_ctl ON risk.risk_control_tests (tenant_id, control_id);

CREATE TABLE IF NOT EXISTS risk.risk_incidents (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  risk_id     uuid,
  title       text        NOT NULL,
  description text        NOT NULL,
  severity    varchar(16) NOT NULL DEFAULT 'minor',
  status      varchar(16) NOT NULL DEFAULT 'open',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reported_by text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_incidents_tenant ON risk.risk_incidents (tenant_id);

CREATE TABLE IF NOT EXISTS risk.risk_mitigation_plans (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL,
  risk_id    uuid        NOT NULL,
  action     text        NOT NULL,
  owner_ref  text,
  due_date   date,
  status     varchar(16) NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid        NOT NULL,
  updated_by uuid        NOT NULL,
  version    integer     NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_risk_mitigation_risk ON risk.risk_mitigation_plans (tenant_id, risk_id);

CREATE TABLE IF NOT EXISTS risk.risk_acceptances (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  risk_id        uuid        NOT NULL,
  rationale      text        NOT NULL,
  residual_score integer     NOT NULL,
  status         varchar(16) NOT NULL DEFAULT 'proposed',
  valid_until    date,
  requested_by   uuid        NOT NULL,
  decided_by     uuid,
  decided_at     timestamptz,
  remarks        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer     NOT NULL DEFAULT 1,
  CONSTRAINT risk_acceptances_status_check CHECK (status IN ('proposed','approved','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_risk_acceptances_risk ON risk.risk_acceptances (tenant_id, risk_id);

CREATE TABLE IF NOT EXISTS risk.risk_reviews (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  risk_id          uuid        NOT NULL,
  outcome          varchar(16) NOT NULL DEFAULT 'unchanged',
  notes            text,
  reviewed_by      text,
  reviewed_at      timestamptz NOT NULL DEFAULT now(),
  next_review_date date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_reviews_risk ON risk.risk_reviews (tenant_id, risk_id);

-- ── ownership + grants + RLS ────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'risk.risk_controls','risk.risk_control_tests','risk.risk_incidents',
    'risk.risk_mitigation_plans','risk.risk_acceptances','risk.risk_reviews'
  ] LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO audit_svc', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO audit_svc', t);
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %s', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
    EXECUTE format('CREATE POLICY tenant_isolation_policy ON %s USING (tenant_id = events.current_tenant_id()) WITH CHECK (tenant_id = events.current_tenant_id())', t);
  END LOOP;
END $$;
