-- SVC-096: extend the vigilance case with a confidential intake → screening →
--   IO assignment → evidence → findings → action-recommendation lifecycle, plus
--   an evidence table and an action table with maker-checker on the decision.
-- Additive & idempotent. New tables carry tenant_id + ENABLE/FORCE RLS +
--   tenant_isolation policy, mirroring 0020_vigilance_investigation_schema.sql
--   (events.current_tenant_id()).
-- Rollback: DROP TABLE vigilance.vigilance_actions, vigilance.vigilance_evidence;
--           ALTER TABLE vigilance.vigilance_cases DROP COLUMN ... (new columns).
-- Affected services: audit-service only.

SET lock_timeout = '5s';

-- ── extend vigilance.vigilance_cases ────────────────────────────────────────
ALTER TABLE vigilance.vigilance_cases ADD COLUMN IF NOT EXISTS complaint_source text;
ALTER TABLE vigilance.vigilance_cases ADD COLUMN IF NOT EXISTS confidential      boolean     NOT NULL DEFAULT true;
ALTER TABLE vigilance.vigilance_cases ADD COLUMN IF NOT EXISTS screening_status  varchar(24) NOT NULL DEFAULT 'pending';
ALTER TABLE vigilance.vigilance_cases ADD COLUMN IF NOT EXISTS assigned_io       text;
ALTER TABLE vigilance.vigilance_cases ADD COLUMN IF NOT EXISTS findings          text;
ALTER TABLE vigilance.vigilance_cases ADD COLUMN IF NOT EXISTS stage             varchar(24) NOT NULL DEFAULT 'intake';
ALTER TABLE vigilance.vigilance_cases ADD COLUMN IF NOT EXISTS closed_at         timestamptz;

DO $$ BEGIN
  ALTER TABLE vigilance.vigilance_cases
    ADD CONSTRAINT vigilance_cases_stage_check
    CHECK (stage IN ('intake','screening','assigned','under_investigation','findings','action_recommended','closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE vigilance.vigilance_cases
    ADD CONSTRAINT vigilance_cases_screening_check
    CHECK (screening_status IN ('pending','admitted','rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── vigilance.vigilance_evidence ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vigilance.vigilance_evidence (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  case_id      uuid        NOT NULL,
  kind         varchar(24) NOT NULL DEFAULT 'document',
  description  text        NOT NULL,
  reference    text,
  collected_by text,
  collected_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vig_evidence_case ON vigilance.vigilance_evidence (tenant_id, case_id);
ALTER TABLE vigilance.vigilance_evidence OWNER TO audit_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON vigilance.vigilance_evidence TO audit_svc;

-- ── vigilance.vigilance_actions (maker-checker) ─────────────────────────────
CREATE TABLE IF NOT EXISTS vigilance.vigilance_actions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  case_id            uuid        NOT NULL,
  recommendation     text        NOT NULL,
  recommended_action varchar(32) NOT NULL,
  status             varchar(16) NOT NULL DEFAULT 'proposed',
  remarks            text,
  proposed_by        uuid        NOT NULL,
  decided_by         uuid,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer     NOT NULL DEFAULT 1,
  CONSTRAINT vigilance_actions_status_check CHECK (status IN ('proposed','approved','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_vig_actions_case ON vigilance.vigilance_actions (tenant_id, case_id);
ALTER TABLE vigilance.vigilance_actions OWNER TO audit_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON vigilance.vigilance_actions TO audit_svc;

-- ── RLS tenant isolation on the new tables ──────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vigilance.vigilance_evidence','vigilance.vigilance_actions'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %s', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
    EXECUTE format('CREATE POLICY tenant_isolation_policy ON %s USING (tenant_id = events.current_tenant_id()) WITH CHECK (tenant_id = events.current_tenant_id())', t);
  END LOOP;
END $$;
