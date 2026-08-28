-- Purpose: Create Encroachment schema and tables (BRD 5.19 ENCR-001..004)
--
-- Found during deep-verification: encroachment/schema.ts (Drizzle),
-- domain.ts, repo.ts, commands.ts, and routes.ts were all fully built, but
-- no migration anywhere ever created this schema or its tables (confirmed:
-- `encroachment` did not appear in \dn on the shared dev DB, and no
-- migration file in this directory references it before this one) — one
-- of three missing pieces alongside the never-registered routes (app.ts)
-- and the entirely absent consumer.ts, all fixed together in this PR.
--
-- RLS posture matches enforcement.* (migration 0012_enforcement_schema.sql)
-- exactly: no ENABLE/FORCE ROW LEVEL SECURITY, tenant isolation enforced at
-- the application layer only (every repo.ts read/write filters by
-- tenant_id explicitly) — not a new decision, just consistent with the
-- sibling schema this module was modeled on.
--
-- Rollback: DROP TABLE IF EXISTS encroachment.encroachment_removals;
--           DROP TABLE IF EXISTS encroachment.encroachment_hearings;
--           DROP TABLE IF EXISTS encroachment.encroachment_notices;
--           DROP TABLE IF EXISTS encroachment.encroachment_complaints;
--           DROP SCHEMA IF EXISTS encroachment;
-- Affected services: inspection-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS encroachment;

CREATE TABLE IF NOT EXISTS encroachment.encroachment_complaints (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  complaint_number          varchar(40) NOT NULL,
  reported_by               uuid NOT NULL,
  reported_at               timestamptz NOT NULL DEFAULT now(),
  location                  jsonb NOT NULL,
  encroachment_type         varchar(40) NOT NULL,
  description               text NOT NULL,
  photos                    jsonb,
  land_parcel_ref           text,
  status                    varchar(30) NOT NULL DEFAULT 'received'
                            CHECK (status IN ('received', 'under_verification', 'verified',
                              'notice_issued', 'hearing_scheduled', 'hearing_done',
                              'removal_ordered', 'removed', 'dismissed', 'appealed')),
  verified_by               uuid,
  verified_at               timestamptz,
  land_verification_report  jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL,
  updated_by                uuid NOT NULL,
  version                   integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS encroachment.encroachment_notices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  complaint_id       uuid NOT NULL,
  notice_number      varchar(40) NOT NULL,
  notice_type        varchar(20) NOT NULL
                     CHECK (notice_type IN ('show_cause', 'eviction', 'demolition')),
  issued_to          text NOT NULL,
  issued_at          timestamptz NOT NULL DEFAULT now(),
  response_deadline  date NOT NULL,
  status             varchar(24) NOT NULL DEFAULT 'issued'
                     CHECK (status IN ('issued', 'served', 'response_received', 'hearing_scheduled', 'expired')),
  served_at          timestamptz,
  response_text      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  version            integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS encroachment.encroachment_hearings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  complaint_id      uuid NOT NULL,
  notice_id         uuid NOT NULL,
  hearing_date      date NOT NULL,
  hearing_time      varchar(8) NOT NULL,
  venue             text NOT NULL,
  officer_id        uuid NOT NULL,
  attendees         jsonb,
  proceedings       text,
  decision          varchar(24)
                    CHECK (decision IS NULL OR decision IN ('removal_ordered', 'fine_imposed', 'regularized', 'dismissed', 'adjourned')),
  fine_amount_minor bigint,
  currency          varchar(3) NOT NULL DEFAULT 'INR',
  next_hearing_date date,
  status            varchar(20) NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'completed', 'adjourned')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS encroachment.encroachment_removals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  complaint_id       uuid NOT NULL,
  ordered_at         timestamptz NOT NULL DEFAULT now(),
  ordered_by         uuid NOT NULL,
  scheduled_date     date NOT NULL,
  status             varchar(20) NOT NULL DEFAULT 'ordered'
                     CHECK (status IN ('ordered', 'team_assigned', 'in_progress', 'completed', 'stayed')),
  team_members       jsonb,
  equipment_used     text,
  completed_at       timestamptz,
  completion_report  jsonb,
  photos             jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  version            integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_encroachment_complaints_tenant
  ON encroachment.encroachment_complaints (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_encroachment_complaints_status
  ON encroachment.encroachment_complaints (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_encroachment_notices_tenant
  ON encroachment.encroachment_notices (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_encroachment_notices_complaint
  ON encroachment.encroachment_notices (complaint_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_encroachment_hearings_tenant
  ON encroachment.encroachment_hearings (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_encroachment_hearings_complaint
  ON encroachment.encroachment_hearings (complaint_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_encroachment_removals_tenant
  ON encroachment.encroachment_removals (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_encroachment_removals_complaint
  ON encroachment.encroachment_removals (complaint_id);

-- ── Grants ─────────────────────────────────────────────────────────────────
-- Schema ownership stays with civitas_admin (this migration must run as
-- civitas_admin — see bootstrap_inspection.sql's own note: "migrations are
-- admin-run and the service role cannot alter its own tables"), so
-- inspection_svc needs USAGE + DML granted explicitly; it has neither by
-- default on a schema it doesn't own. Mirrors bootstrap_inspection.sql's
-- own grant block verbatim (that file documents "re-run this section after
-- any migration that adds a schema" — this inlines exactly that for this
-- one new schema instead of relying on someone remembering to do it by
-- hand, which is how encroachment/illegal_construction ended up with a
-- schema nothing could read from in the first place).
GRANT USAGE ON SCHEMA encroachment TO inspection_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA encroachment TO inspection_svc;
ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA encroachment
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO inspection_svc;
