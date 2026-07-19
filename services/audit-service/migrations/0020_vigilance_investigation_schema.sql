-- Purpose: create the vigilance.vigilance_cases and investigation.investigations
--   tables. These were referenced by src/modules/vigilance/schema.ts,
--   src/modules/investigation/schema.ts, and even had a status/inquiry_status
--   CHECK constraint added against them in
--   0018_additional_status_type_constraints.sql (via a DO $$ ... EXCEPTION
--   WHEN duplicate_object block, which is why that migration did not fail —
--   ADD CONSTRAINT on a non-existent table raises undefined_table, not
--   duplicate_object, so those two ALTER TABLE statements in 0018 have been
--   silently erroring out — but no prior migration ever issued the
--   CREATE SCHEMA / CREATE TABLE for either module. Route code
--   (vigilance/routes.ts, investigation/routes.ts), repo.ts, and queries.ts
--   all query these tables today, so every GET /v1/audit/vigilance and
--   GET /v1/audit/investigations request fails with
--   "relation ... does not exist".
-- Rollback: DROP TABLE vigilance.vigilance_cases; DROP SCHEMA vigilance;
--           DROP TABLE investigation.investigations; DROP SCHEMA investigation;
-- Affected services: audit-service only.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS vigilance;
CREATE SCHEMA IF NOT EXISTS investigation;

-- ── vigilance.vigilance_cases (mirrors src/modules/vigilance/schema.ts) ────
CREATE TABLE IF NOT EXISTS vigilance.vigilance_cases (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  case_no        text        NOT NULL,
  officer        text        NOT NULL,
  charges        text        NOT NULL,
  inquiry_status varchar(32) NOT NULL DEFAULT 'preliminary_enquiry',
  outcome        varchar(24) NOT NULL DEFAULT 'pending',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_vigilance_cases_tenant
  ON vigilance.vigilance_cases (tenant_id);

ALTER TABLE vigilance.vigilance_cases OWNER TO audit_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON vigilance.vigilance_cases TO audit_svc;

-- ── investigation.investigations (mirrors src/modules/investigation/schema.ts) ─
CREATE TABLE IF NOT EXISTS investigation.investigations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  case_id      text        NOT NULL,
  subject      text        NOT NULL,
  assigned_to  text        NOT NULL,
  started      timestamptz NOT NULL DEFAULT now(),
  findings     text        NOT NULL DEFAULT '',
  status       varchar(24) NOT NULL DEFAULT 'in_progress',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        NOT NULL,
  updated_by   uuid        NOT NULL,
  version      integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_investigations_tenant
  ON investigation.investigations (tenant_id);

ALTER TABLE investigation.investigations OWNER TO audit_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON investigation.investigations TO audit_svc;

-- ── RLS tenant isolation (same pattern as 0013_rls_full_tenant_isolation.sql) ─
ALTER TABLE vigilance.vigilance_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE vigilance.vigilance_cases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON vigilance.vigilance_cases;
DROP POLICY IF EXISTS tenant_isolation ON vigilance.vigilance_cases;
CREATE POLICY tenant_isolation_policy ON vigilance.vigilance_cases
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

ALTER TABLE investigation.investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE investigation.investigations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON investigation.investigations;
DROP POLICY IF EXISTS tenant_isolation ON investigation.investigations;
CREATE POLICY tenant_isolation_policy ON investigation.investigations
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- ── re-apply the 0018 status/inquiry_status CHECK constraints now that the
--    tables actually exist (those ALTER TABLE statements in 0018 silently
--    failed with undefined_table against a nonexistent relation and were
--    never applied) ──────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE vigilance.vigilance_cases
    ADD CONSTRAINT vigilance_cases_inquiry_status_check
    CHECK (inquiry_status IN ('preliminary_enquiry', 'under_investigation', 'charge_sheet_issued', 'inquiry_complete'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE investigation.investigations
    ADD CONSTRAINT investigations_status_check
    CHECK (status IN ('in_progress', 'findings_submitted', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE vigilance.vigilance_cases VALIDATE CONSTRAINT vigilance_cases_inquiry_status_check;
ALTER TABLE investigation.investigations VALIDATE CONSTRAINT investigations_status_check;
