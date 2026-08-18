-- Purpose: Create works.contractor_ratings table for contractor rating history.
-- Each PATCH /contractors/:id/rate event appends a row; the aggregate is kept
-- on works.contractors.performance_rating (incremental average).
-- Rollback: DROP TABLE IF EXISTS works.contractor_ratings;
-- Affected services: works-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS works.contractor_ratings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  contractor_id  uuid NOT NULL REFERENCES works.contractors(id) ON DELETE CASCADE,
  rating         integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  rated_by       uuid NOT NULL,
  rated_at       timestamptz NOT NULL DEFAULT now(),
  note           text
);

CREATE INDEX IF NOT EXISTS contractor_ratings_contractor_idx
  ON works.contractor_ratings (contractor_id, rated_at DESC);

CREATE INDEX IF NOT EXISTS contractor_ratings_tenant_idx
  ON works.contractor_ratings (tenant_id);

-- Enable FORCE RLS — same pattern as all other works tables.
ALTER TABLE works.contractor_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE works.contractor_ratings FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'contractor_ratings' AND schemaname = 'works' AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON works.contractor_ratings
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    $pol$;
  END IF;
END $$;
