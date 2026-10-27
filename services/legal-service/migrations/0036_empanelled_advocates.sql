-- Migration: 0036_empanelled_advocates
-- Purpose: GAP-LEGAL-LIST-04 (owner decision #14). A small empanelled-advocate master per tenant
--   (name, Bar enrolment number, contact) and cases.legal_cases.advocate_id linking a case to it, so
--   case lists show the advocate's name from the master instead of free text. counsel_ref stays as
--   the legacy free-text value for cases that predate the master.
-- Rollback:
--   ALTER TABLE cases.legal_cases DROP COLUMN IF EXISTS advocate_id;
--   DROP TABLE IF EXISTS counsel.empanelled_advocates;
-- Affected services: legal-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS counsel;

CREATE TABLE IF NOT EXISTS counsel.empanelled_advocates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  name              TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  bar_enrolment_no  TEXT NOT NULL CHECK (length(btrim(bar_enrolment_no)) > 0),
  contact           TEXT NOT NULL CHECK (length(btrim(contact)) > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID NOT NULL,
  updated_by        UUID NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1
);

-- One advocate per Bar enrolment number per tenant (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS uq_empanelled_advocates_bar
  ON counsel.empanelled_advocates (tenant_id, lower(btrim(bar_enrolment_no)));

ALTER TABLE counsel.empanelled_advocates ENABLE ROW LEVEL SECURITY;
ALTER TABLE counsel.empanelled_advocates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON counsel.empanelled_advocates;
CREATE POLICY tenant_isolation ON counsel.empanelled_advocates
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE cases.legal_cases
  ADD COLUMN IF NOT EXISTS advocate_id UUID;

CREATE INDEX IF NOT EXISTS idx_legal_cases_advocate
  ON cases.legal_cases (tenant_id, advocate_id);
