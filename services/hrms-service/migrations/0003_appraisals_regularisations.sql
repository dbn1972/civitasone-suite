-- hrms-service migration 0003
-- Adds: manager_id on employees, attendance regularisations, appraisal schema+table.

ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS manager_id uuid;

CREATE INDEX IF NOT EXISTS idx_hrms_emp_manager ON employee.hrms_employees(tenant_id, manager_id)
  WHERE manager_id IS NOT NULL;

-- ── attendance regularisations ────────────────────────────────────

CREATE TABLE IF NOT EXISTS attendance.hrms_attendance_regularisations (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  employee_id       uuid        NOT NULL,
  date              date        NOT NULL,
  reason            text        NOT NULL,
  requested_status  varchar(32) NOT NULL DEFAULT 'present',
  status            varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  requested_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_by        uuid        NOT NULL,
  version           integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_hrms_reg_tenant_status
  ON attendance.hrms_attendance_regularisations(tenant_id, status);

-- ── appraisal module ──────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS appraisal;

CREATE TABLE IF NOT EXISTS appraisal.hrms_appraisals (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  employee_id       uuid        NOT NULL,
  appraisal_period  varchar(16) NOT NULL,
  rating            numeric(3,1),
  status            varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_review','completed')),
  reviewer_id       uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_by        uuid        NOT NULL,
  version           integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_hrms_appraisal_tenant
  ON appraisal.hrms_appraisals(tenant_id, status);
