-- Purpose: Create Survey & Sampling schema and tables (SVC-104)
-- Rollback: DROP TABLE IF EXISTS survey.survey_aggregations;
--           DROP TABLE IF EXISTS survey.survey_responses;
--           DROP TABLE IF EXISTS survey.sampling_frames;
--           DROP TABLE IF EXISTS survey.survey_definitions;
--           DROP SCHEMA IF EXISTS survey;
-- Affected services: inspection-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS survey;

CREATE TABLE IF NOT EXISTS survey.survey_definitions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  title                text NOT NULL,
  description          text,
  target_entity_type   varchar(64) NOT NULL,
  questionnaire        jsonb NOT NULL,
  sampling_method      varchar(16) NOT NULL
                       CHECK (sampling_method IN ('random', 'stratified', 'systematic')),
  sample_size_percent  numeric(5,2) NOT NULL,
  stratification_field text,
  status               varchar(16) NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'active', 'closed')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS survey.sampling_frames (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  survey_id          uuid NOT NULL,
  entity_ids         jsonb NOT NULL,
  total_population   integer NOT NULL,
  sample_size        integer NOT NULL,
  selected_at        timestamptz NOT NULL DEFAULT now(),
  selection_criteria jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  version            integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS survey.survey_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  survey_id      uuid NOT NULL,
  entity_id      uuid NOT NULL,
  inspector_id   uuid NOT NULL,
  answers        jsonb NOT NULL,
  captured_at    timestamptz NOT NULL,
  device_id      text,
  sync_upload_id uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS survey.survey_aggregations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  survey_id          uuid NOT NULL,
  computed_at        timestamptz NOT NULL DEFAULT now(),
  response_count     integer NOT NULL,
  response_rate      numeric(5,2) NOT NULL,
  question_summaries jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_survey_def_tenant
  ON survey.survey_definitions (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_survey_def_status
  ON survey.survey_definitions (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sampling_frames_survey
  ON survey.sampling_frames (survey_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_survey_responses_survey
  ON survey.survey_responses (tenant_id, survey_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_survey_responses_entity
  ON survey.survey_responses (tenant_id, entity_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_survey_aggregations_survey
  ON survey.survey_aggregations (tenant_id, survey_id);
