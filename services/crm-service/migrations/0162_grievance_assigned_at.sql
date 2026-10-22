-- 0162_grievance_assigned_at.sql
-- Purpose: GAP-CRM-GRIEVANCES-DETAIL-04 -- record WHEN a grievance was (last) assigned, so the
--   grievance detail timeline's "Assigned" step can show a real time. Until now PATCH
--   /v1/crm/grievances/:id/assign only set assigned_to; no column held the assignment time, so the
--   timeline step was a bare tick with no timestamp (and the audit outbox is not a read model).
-- Rollback: ALTER TABLE crm.grievances DROP COLUMN IF EXISTS assigned_at;
-- Affected services: crm-service (modules/grievances/routes.ts: assign + detail).
-- Sequencing: additive and nullable -- no backfill, no default, no rewrite of existing rows.
--   Grievances assigned before this migration keep assigned_at NULL ("assigned, time unknown");
--   the timeline shows the step done without a time rather than inventing one.
SET lock_timeout = '5s';

ALTER TABLE crm.grievances
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
