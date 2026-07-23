-- Purpose: Create Licence Compliance schema and tables (SVC-108)
-- Rollback: DROP TABLE IF EXISTS licence.licence_conditions;
--           DROP TABLE IF EXISTS licence.licences;
--           DROP SCHEMA IF EXISTS licence;
-- Affected services: inspection-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS licence;

CREATE TABLE IF NOT EXISTS licence.licences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  entity_id       uuid NOT NULL,
  licence_type    varchar(64) NOT NULL,
  licence_number  text NOT NULL,
  issued_at       timestamptz,
  valid_from      date NOT NULL,
  valid_to        date NOT NULL,
  conditions      jsonb,
  status          varchar(24) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'expired', 'suspended',
                         'revoked', 'pending_renewal')),
  renewal_fee     bigint,
  currency        varchar(3) NOT NULL DEFAULT 'INR',
  last_renewal_at timestamptz,
  reminder_sent_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS licence.licence_conditions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  licence_id        uuid NOT NULL,
  condition_text    text NOT NULL,
  compliance_status varchar(16) NOT NULL DEFAULT 'pending'
                    CHECK (compliance_status IN ('met', 'not_met', 'pending')),
  verified_at       timestamptz,
  verified_by       uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_licence_tenant
  ON licence.licences (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_licence_entity
  ON licence.licences (tenant_id, entity_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_licence_status
  ON licence.licences (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_licence_valid_to
  ON licence.licences (tenant_id, valid_to);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_licence_conditions_licence
  ON licence.licence_conditions (licence_id);
