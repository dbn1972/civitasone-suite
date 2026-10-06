-- Purpose: F6-03 — service-type master gains an optional SLA target (sla_hours).
--   When a service request is created against a type that carries an SLA and no
--   explicit dueAt is supplied, the server derives due_at = created_at + sla_hours.
--   Nullable, so existing rows and types without an SLA keep today's behaviour.
-- Rollback: ALTER TABLE crm.service_types DROP COLUMN IF EXISTS sla_hours;
-- Affected services: crm-service (service-requests module)
-- Sequencing: additive — one nullable column, no backfill, backward compatible.

SET lock_timeout = '5s';

ALTER TABLE crm.service_types
  ADD COLUMN IF NOT EXISTS sla_hours integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'crm' AND constraint_name = 'chk_service_types_sla_hours_positive'
  ) THEN
    ALTER TABLE crm.service_types
      ADD CONSTRAINT chk_service_types_sla_hours_positive
      CHECK (sla_hours IS NULL OR (sla_hours > 0 AND sla_hours <= 87600));
  END IF;
END $$;
