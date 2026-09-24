-- Purpose: add a new terminal "routing_failed" state to leave.hrms_leave_apps.status.
--
-- Root cause this supports: the leave-consumer (hrms-service) always asks
-- workflow-service to create a "leave_approval" workflow instance when an
-- application is submitted. If the tenant has no active
-- workflow.definitions row for that code, workflow-service fails closed
-- (persists a *rejected workflow instance*, emits
-- "workflow.instance.rejected") but nothing previously updated the leave
-- application's own row -- it stayed on "pending" forever, indistinguishable
-- from a normal, still-in-progress request, with zero visible symptom to
-- either the applicant or HR. leave/consumer.ts now subscribes to that
-- rejection event and moves the affected application to this new status so
-- its own status/detail views (leave/history, the self-service leave-
-- applications list) can say so honestly instead of showing a bare
-- "Pending". See leave/domain.ts's assertLeaveAppStatusTransition for the
-- (one-directional, from `pending` only) transition rule.
--
-- Rollback: DROP CONSTRAINT hrms_leave_apps_status_check, then re-add the
-- prior 5-value version from migration 0035 (only safe once no row actually
-- holds 'routing_failed').
-- Affected services: hrms-service

SET lock_timeout = '5s';

-- CHECK constraints can't be widened in place (no "ALTER CONSTRAINT ADD
-- VALUE" the way native enum types support) -- drop and re-add. DROP ...
-- IF EXISTS + a plain ADD (rather than 0035's ADD-with-duplicate_object-
-- guard) is enough to make this file itself idempotent: a second run drops
-- the constraint this same file just added and recreates the identical
-- one, with no error either way.
ALTER TABLE leave.hrms_leave_apps
  DROP CONSTRAINT IF EXISTS hrms_leave_apps_status_check;

-- NOT VALID: applies to all new inserts/updates immediately without taking
-- a full-table scan/lock to check pre-existing rows (none of which can
-- hold 'routing_failed' yet, so there is nothing to backfill-validate).
ALTER TABLE leave.hrms_leave_apps
  ADD CONSTRAINT hrms_leave_apps_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'cancelled', 'routing_failed'))
  NOT VALID;
