-- Purpose: Create Illegal Construction schema and tables (BRD 5.20 ILBLD-001..004)
--
-- Same missing-migration defect as encroachment (0026_encroachment_schema.sql,
-- same PR): illegal-construction/schema.ts, domain.ts, repo.ts, commands.ts,
-- and routes.ts were all fully built, but no migration anywhere ever created
-- this schema or its tables, on top of the never-registered routes and the
-- entirely absent consumer.ts.
--
-- RLS posture matches enforcement.* (migration 0012_enforcement_schema.sql):
-- no ENABLE/FORCE ROW LEVEL SECURITY, tenant isolation at the application
-- layer only, consistent with the sibling schema this module was modeled on.
--
-- Rollback: DROP TABLE IF EXISTS illegal_construction.illegal_construction_actions;
--           DROP TABLE IF EXISTS illegal_construction.illegal_construction_cases;
--           DROP SCHEMA IF EXISTS illegal_construction;
-- Affected services: inspection-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS illegal_construction;

CREATE TABLE IF NOT EXISTS illegal_construction.illegal_construction_cases (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL,
  case_number              varchar(40) NOT NULL,
  reported_by              uuid NOT NULL,
  reported_at              timestamptz NOT NULL DEFAULT now(),
  location                 jsonb NOT NULL,
  building_permit_ref      text,
  owner_name               text NOT NULL,
  owner_contact            text,
  violation_type           varchar(30) NOT NULL
                           CHECK (violation_type IN ('no_permit', 'deviation_from_plan',
                             'unauthorized_floor', 'setback_violation', 'fsi_exceeded',
                             'unauthorized_use_change')),
  description              text NOT NULL,
  photos                   jsonb,
  status                   varchar(30) NOT NULL DEFAULT 'reported'
                           CHECK (status IN ('reported', 'inspected', 'violation_confirmed',
                             'notice_issued', 'hearing_done', 'stop_work_ordered', 'sealed',
                             'demolition_ordered', 'demolished', 'regularized', 'dismissed')),
  inspected_by             uuid,
  inspected_at             timestamptz,
  inspection_findings      jsonb,
  violation_checklist      jsonb,
  regularization_details   jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL,
  updated_by               uuid NOT NULL,
  version                  integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS illegal_construction.illegal_construction_actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  case_id           uuid NOT NULL,
  action_type       varchar(30) NOT NULL
                    CHECK (action_type IN ('stop_work_notice', 'sealing_order',
                      'demolition_order', 'fine', 'regularization_order')),
  action_number     varchar(40) NOT NULL,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  issued_by         uuid NOT NULL,
  status            varchar(20) NOT NULL DEFAULT 'issued'
                    CHECK (status IN ('issued', 'enforced', 'complied', 'appealed', 'stayed')),
  enforced_at       timestamptz,
  details           jsonb,
  fine_amount_minor bigint,
  currency          varchar(3) NOT NULL DEFAULT 'INR',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_illegal_construction_cases_tenant
  ON illegal_construction.illegal_construction_cases (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_illegal_construction_cases_status
  ON illegal_construction.illegal_construction_cases (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_illegal_construction_actions_tenant
  ON illegal_construction.illegal_construction_actions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_illegal_construction_actions_case
  ON illegal_construction.illegal_construction_actions (case_id);

-- ── Grants ─────────────────────────────────────────────────────────────────
-- Same reasoning as 0026_encroachment_schema.sql's grants block: schema
-- ownership stays with civitas_admin, so inspection_svc needs USAGE + DML
-- granted explicitly — mirrors bootstrap_inspection.sql's grant block for
-- this one new schema.
GRANT USAGE ON SCHEMA illegal_construction TO inspection_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA illegal_construction TO inspection_svc;
ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA illegal_construction
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO inspection_svc;
