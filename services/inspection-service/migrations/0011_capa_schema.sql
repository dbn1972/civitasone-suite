-- Purpose: Create CAPA (Corrective & Preventive Action) schema and tables (SVC-106)
-- Rollback: DROP TABLE IF EXISTS capa.corrective_actions; DROP SCHEMA IF EXISTS capa;
-- Affected services: inspection-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS capa;

CREATE TABLE IF NOT EXISTS capa.corrective_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  finding_id      uuid NOT NULL,
  type            varchar(16) NOT NULL CHECK (type IN ('corrective', 'preventive')),
  description     text NOT NULL,
  owner_id        uuid,
  due_date        date,
  status          varchar(24) NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'in_progress', 'completed', 'verified', 'overdue')),
  evidence_of_closure     jsonb,
  effectiveness_verified  boolean NOT NULL DEFAULT false,
  verified_by             uuid,
  verified_at             timestamptz,
  re_inspection_triggered boolean NOT NULL DEFAULT false,
  re_inspection_id        uuid,
  escalated_to            uuid,
  escalated_at            timestamptz,
  closed_at               timestamptz,
  closed_by               uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_capa_tenant_id
  ON capa.corrective_actions (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_capa_finding_id
  ON capa.corrective_actions (finding_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_capa_status
  ON capa.corrective_actions (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_capa_owner_id
  ON capa.corrective_actions (tenant_id, owner_id);
