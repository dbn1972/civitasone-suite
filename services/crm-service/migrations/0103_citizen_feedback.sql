-- Purpose: GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05 — crm.citizen_feedback stores a
--   citizen's self-reported service rating (1-5) and an optional free-text comment,
--   optionally "regarding" a service request (opaque service_request_id, NOT a FK —
--   the SR lives in the same service's service-requests module but is referenced by
--   id to keep this table independently extractable). This is DISTINCT from
--   crm.interaction_sentiments (which is model-scored from logged interactions and
--   has no citizen write path): a rating is the citizen's own voice, surfaced on the
--   VoC dashboard as a separate "Citizen ratings" tile (average + count), never mixed
--   into the sentiment aggregate. The comment is free text the citizen typed; it is
--   only ever shown unmasked to CRM admins (CRM_PII_READ_ROLES) — see routes/queries.
-- Rollback: DROP TABLE IF EXISTS crm.citizen_feedback;
-- Affected services: crm-service (sentiment / voice-of-customer module)
-- Sequencing: additive — a new tenant-scoped table with no FKs into existing tables,
--   safe to apply before the code that writes it. No backfill (the tile reads 0/'—'
--   until feedback arrives).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.citizen_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  -- Optional opaque reference to the service request this feedback is about. No
  -- cross-module foreign key (CLAUDE.md §3.13) — resolved by id when displayed.
  service_request_id uuid,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  -- Free text the citizen typed. Bounded so one entry cannot dominate storage, and
  -- shown unmasked only to CRM admins (DPDP: it may contain whatever the citizen
  -- chose to disclose). Never logged.
  comment text CHECK (comment IS NULL OR char_length(comment) <= 2000),
  -- 'anonymous' | 'registered' — mirrors the form's submission type. No citizen
  -- identity is stored here; a registered submission is still attributed only by the
  -- authenticated actor who recorded it.
  submission_type varchar(16) NOT NULL DEFAULT 'anonymous'
    CHECK (submission_type IN ('anonymous','registered')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

-- The ratings tile scans a tenant's feedback newest-first and aggregates average+count.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_feedback_tenant_created
  ON crm.citizen_feedback(tenant_id, created_at DESC);
-- "Regarding" lookups by service request.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_feedback_tenant_sr
  ON crm.citizen_feedback(tenant_id, service_request_id)
  WHERE service_request_id IS NOT NULL;

ALTER TABLE crm.citizen_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.citizen_feedback FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'citizen_feedback_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'citizen_feedback'
  ) THEN
    CREATE POLICY citizen_feedback_tenant_isolation ON crm.citizen_feedback
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.citizen_feedback TO crm_svc;
  END IF;
END $g$;
