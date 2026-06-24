-- 0023_security_h1_m_findings.sql
-- SECURITY remediation (hrms-service):
--   H1: enforce at-most-one ACTIVE pay-suspension per (tenant, employee) so the
--       payroll subsistence% read is deterministic. A partial UNIQUE index is the
--       DB backstop behind the new 409 application check.
-- Additive + idempotent only. No money columns. Tenant-scoped.

-- ===========================================================================
-- H1 — at most one active suspension per (tenant, employee)
-- ===========================================================================
-- NOTE: this assumes no pre-existing duplicates. If the create call had ever
-- produced two active rows for one employee, this CREATE would fail; we verified
-- there are none before applying (see remediation notes). The index is partial
-- so revoked rows never collide.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_susp_one_active_uq
  ON disciplinary.hrms_suspensions (tenant_id, employee_id)
  WHERE status = 'active';
