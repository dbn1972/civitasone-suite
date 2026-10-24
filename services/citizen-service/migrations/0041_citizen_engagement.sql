-- citizen-service migration 0041: real backing stores for the citizen
-- engagement screens (/citizen/alerts, /citizen/notices, /citizen/surveys),
-- which previously answered an honest 501 NOT_IMPLEMENTED from
-- modules/gap/routes.ts because no store existed. Additive, idempotent.
--
--   engagement.citizen_alerts           public alerts / advisories (draft -> active -> withdrawn;
--                                       "expired" is DERIVED from expires_at, never stored)
--   engagement.citizen_notices          public notice board (draft -> published -> withdrawn)
--   engagement.citizen_surveys          citizen surveys (draft -> active -> completed)
--   engagement.citizen_survey_responses one response per (survey, citizen); OWNER-SCOPED reads
--
-- All four are tenant-scoped with FORCE ROW LEVEL SECURITY, same policy shape as
-- requests.* (migration 0031). No DML here, so no NO FORCE / FORCE wrap is needed.

CREATE SCHEMA IF NOT EXISTS engagement AUTHORIZATION citizen_svc;

CREATE TABLE IF NOT EXISTS engagement.citizen_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  title            varchar(200) NOT NULL,
  body             text NOT NULL DEFAULT '',
  category         varchar(64) NOT NULL DEFAULT 'general',
  target_audience  varchar(128) NOT NULL DEFAULT 'All Citizens',
  status           varchar(16) NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','active','withdrawn')),
  published_at     timestamptz,
  expires_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS engagement.citizen_notices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  notice_no     varchar(64) NOT NULL,
  subject       varchar(300) NOT NULL,
  body          text NOT NULL DEFAULT '',
  department    varchar(128) NOT NULL,
  notice_type   varchar(24) NOT NULL DEFAULT 'general'
                  CHECK (notice_type IN ('statutory','public_hearing','tender','general')),
  status        varchar(16) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','published','withdrawn')),
  published_at  timestamptz,
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  CONSTRAINT uq_citizen_notices_tenant_no UNIQUE (tenant_id, notice_no)
);

CREATE TABLE IF NOT EXISTS engagement.citizen_surveys (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  survey_name       varchar(200) NOT NULL,
  description       text NOT NULL DEFAULT '',
  questions         jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_responses  integer CHECK (target_responses IS NULL OR target_responses > 0),
  starts_on         date,
  ends_on           date,
  status            varchar(16) NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','active','completed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT ck_citizen_surveys_dates CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS engagement.citizen_survey_responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  survey_id     uuid NOT NULL REFERENCES engagement.citizen_surveys(id) ON DELETE CASCADE,
  citizen_id    uuid NOT NULL,
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  CONSTRAINT uq_citizen_survey_response_owner UNIQUE (tenant_id, survey_id, citizen_id)
);

CREATE INDEX IF NOT EXISTS idx_citizen_alerts_tenant_status_pub
  ON engagement.citizen_alerts (tenant_id, status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_citizen_notices_tenant_status_pub
  ON engagement.citizen_notices (tenant_id, status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_citizen_surveys_tenant_status
  ON engagement.citizen_surveys (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_citizen_survey_responses_tenant_survey
  ON engagement.citizen_survey_responses (tenant_id, survey_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_citizen_survey_responses_tenant_citizen
  ON engagement.citizen_survey_responses (tenant_id, citizen_id);

ALTER TABLE engagement.citizen_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement.citizen_alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON engagement.citizen_alerts;
CREATE POLICY tenant_isolation ON engagement.citizen_alerts
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

ALTER TABLE engagement.citizen_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement.citizen_notices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON engagement.citizen_notices;
CREATE POLICY tenant_isolation ON engagement.citizen_notices
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

ALTER TABLE engagement.citizen_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement.citizen_surveys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON engagement.citizen_surveys;
CREATE POLICY tenant_isolation ON engagement.citizen_surveys
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

ALTER TABLE engagement.citizen_survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement.citizen_survey_responses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON engagement.citizen_survey_responses;
CREATE POLICY tenant_isolation ON engagement.citizen_survey_responses
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

ALTER TABLE engagement.citizen_alerts OWNER TO citizen_svc;
ALTER TABLE engagement.citizen_notices OWNER TO citizen_svc;
ALTER TABLE engagement.citizen_surveys OWNER TO citizen_svc;
ALTER TABLE engagement.citizen_survey_responses OWNER TO citizen_svc;

-- Rollback:
--   DROP SCHEMA engagement CASCADE;
