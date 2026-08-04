-- Purpose: LQ-001 — per-tenant lead qualification frameworks. A framework is a
--          named set of weighted questions (frameworks vary by business line); a
--          lead is qualified by answering them, which computes an outcome + score
--          and is recorded in crm.lead_qualifications for audit/reporting.
-- Rollback: DROP TABLE IF EXISTS crm.lead_qualifications;
--           DROP TABLE IF EXISTS crm.qualification_questions;
--           DROP TABLE IF EXISTS crm.qualification_frameworks;
-- Affected services: crm-service
-- Sequencing: additive — three new tenant-scoped tables. questions/qualifications
--             reference frameworks within the same tenant; no FK into existing tables.

SET lock_timeout = '5s';

-- ── Frameworks ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm.qualification_frameworks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  name          varchar(160) NOT NULL,
  -- Frameworks vary by business line (the AC): e.g. 'enterprise', 'smb', 'govt'.
  -- NULL means the framework applies to every business line.
  business_line varchar(64),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qual_frameworks_tenant_line
  ON crm.qualification_frameworks (tenant_id, business_line) WHERE active = true;

ALTER TABLE crm.qualification_frameworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.qualification_frameworks FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='crm'
      AND tablename='qualification_frameworks' AND policyname='qual_frameworks_tenant_isolation') THEN
    CREATE POLICY qual_frameworks_tenant_isolation ON crm.qualification_frameworks
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- ── Questions ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm.qualification_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id  uuid NOT NULL REFERENCES crm.qualification_frameworks(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL,
  prompt        varchar(400) NOT NULL,
  -- bool | select | number — how the answer is captured and scored.
  answer_type   varchar(8) NOT NULL DEFAULT 'bool'
    CHECK (answer_type IN ('bool', 'select', 'number')),
  weight        integer NOT NULL DEFAULT 0 CHECK (weight BETWEEN 0 AND 100),
  -- outcome_rule drives per-question scoring: for 'select' a { options: {value: score} }
  -- map; for 'number' a { tiers: [{ min, score }] } ladder; for 'bool' a
  -- { whenTrue, whenFalse } pair. Interpreted by qualification-domain.ts.
  outcome_rule  jsonb NOT NULL DEFAULT '{}'::jsonb,
  "order"       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qual_questions_framework
  ON crm.qualification_questions (tenant_id, framework_id, "order");

ALTER TABLE crm.qualification_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.qualification_questions FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='crm'
      AND tablename='qualification_questions' AND policyname='qual_questions_tenant_isolation') THEN
    CREATE POLICY qual_questions_tenant_isolation ON crm.qualification_questions
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- ── Lead qualifications (submitted answers + computed outcome) ─────────────────
CREATE TABLE IF NOT EXISTS crm.lead_qualifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  lead_id       uuid NOT NULL,
  framework_id  uuid NOT NULL,
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome       varchar(24) NOT NULL,
  score         integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  qualified_by  uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_qualifications_lead
  ON crm.lead_qualifications (tenant_id, lead_id, created_at DESC);

ALTER TABLE crm.lead_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_qualifications FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='crm'
      AND tablename='lead_qualifications' AND policyname='lead_qualifications_tenant_isolation') THEN
    CREATE POLICY lead_qualifications_tenant_isolation ON crm.lead_qualifications
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.qualification_frameworks TO crm_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.qualification_questions TO crm_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.lead_qualifications TO crm_svc;
  END IF;
END $g$;
