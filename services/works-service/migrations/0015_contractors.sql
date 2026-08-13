-- Purpose: Create works.contractors table for contractor management module.
-- Contractors are registered entities referenced by tender quotations / awards.
-- RLS: same FORCE RLS + tenant_id isolation as all other works tables.
-- Rollback: DROP TABLE IF EXISTS works.contractors;
-- Affected services: works-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS works.contractors (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL,
  name             varchar(256) NOT NULL,
  registration_no  varchar(64),
  class_id         uuid,
  pan              varchar(10),
  gst              varchar(15),
  email            varchar(256),
  phone            varchar(20),
  address          text,
  performance_rating integer,
  rating_count     integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  version          integer NOT NULL DEFAULT 1,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contractors_tenant_idx ON works.contractors (tenant_id);
CREATE INDEX IF NOT EXISTS contractors_name_idx   ON works.contractors (tenant_id, name);

-- Enable FORCE RLS — same pattern as all other works tables.
ALTER TABLE works.contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE works.contractors FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'contractors' AND schemaname = 'works' AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON works.contractors
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    $pol$;
  END IF;
END $$;
