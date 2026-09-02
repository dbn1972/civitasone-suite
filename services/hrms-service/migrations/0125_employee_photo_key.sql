-- Migration 0125: add employee.hrms_employees.photo_key
--
-- Root cause: employee/schema.ts declared `photoKey: text("photo_key")` on
-- hrmsEmployees (added alongside the face-verification/id-cards work) but no
-- migration ever added the column to the actual table. Every Drizzle
-- select()/insert() over hrms_employees fails with
-- `column "photo_key" of relation "hrms_employees" does not exist` (42703)
-- on a cluster bootstrapped from the current migrations — this blocks the
-- majority of employee-table-touching tests across the service (self-service,
-- workforce-planning, nps-account, cpf-account, and others), and would 500
-- real employee list/detail requests in production the same way.
--
-- Idempotent: safe to re-run.

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS photo_key text;

COMMIT;
