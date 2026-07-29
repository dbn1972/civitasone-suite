-- 0091_candidate_professional.sql
-- Candidate identity & profile — skills, certifications, languages and credentials
-- (publications/patents/memberships/awards). Checklist R-RA-0086.
-- Four new candidate-schema sub-tables. FORCE RLS. Additive + idempotent.
--
-- Rollback: DROP TABLE candidate.hrms_candidate_skills, candidate.hrms_candidate_certifications,
--           candidate.hrms_candidate_languages, candidate.hrms_candidate_credentials;

CREATE TABLE IF NOT EXISTS candidate.hrms_candidate_skills (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  candidate_id  uuid NOT NULL,
  skill         varchar(120) NOT NULL,
  proficiency   varchar(16) NOT NULL,
  years_experience numeric(4,1),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_candidate_skills_prof_check CHECK (proficiency IN ('beginner','intermediate','advanced','expert'))
);

CREATE TABLE IF NOT EXISTS candidate.hrms_candidate_certifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  candidate_id   uuid NOT NULL,
  cert_name      varchar(200) NOT NULL,
  issuer         varchar(200) NOT NULL,
  issue_date     date,
  expiry_date    date,
  credential_id  varchar(120),
  credential_url varchar(512),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidate.hrms_candidate_languages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  candidate_id uuid NOT NULL,
  language     varchar(64) NOT NULL,
  can_read     boolean NOT NULL DEFAULT false,
  can_write    boolean NOT NULL DEFAULT false,
  can_speak    boolean NOT NULL DEFAULT false,
  proficiency  varchar(16),
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- Symmetric DB-level guard (matches skills.proficiency / credentials.kind).
ALTER TABLE candidate.hrms_candidate_languages
  DROP CONSTRAINT IF EXISTS hrms_candidate_languages_prof_check;
ALTER TABLE candidate.hrms_candidate_languages
  ADD CONSTRAINT hrms_candidate_languages_prof_check
  CHECK (proficiency IS NULL OR proficiency IN ('basic','conversational','fluent','native'));

CREATE TABLE IF NOT EXISTS candidate.hrms_candidate_credentials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  candidate_id  uuid NOT NULL,
  kind          varchar(16) NOT NULL,                 -- publication | patent | membership | award
  title         varchar(300) NOT NULL,
  detail        text,
  cred_year     integer,
  reference_url varchar(512),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_candidate_credentials_kind_check CHECK (kind IN ('publication','patent','membership','award'))
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hrms_candidate_skills','hrms_candidate_certifications','hrms_candidate_languages','hrms_candidate_credentials']
  LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON candidate.%I (tenant_id, candidate_id)', t||'_cand_idx', t);
    EXECUTE format('ALTER TABLE candidate.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE candidate.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON candidate.%I', t||'_tenant_isolation', t);
    EXECUTE format('CREATE POLICY %I ON candidate.%I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t||'_tenant_isolation', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON candidate.%I TO hrms_svc', t);
  END LOOP;
END $$;
