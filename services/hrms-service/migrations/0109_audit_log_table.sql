-- Purpose: Add local audit_log table within HRMS database for e-Governance compliance.
-- Government service rules require tamper-evident audit trails co-located with the data.
-- This supplements the central audit-service (which may be unavailable during network partitions).
-- Rollback: DROP TABLE IF EXISTS employee.hrms_audit_log;
-- Affected services: hrms-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS employee.hrms_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  actor_id      UUID NOT NULL,
  actor_name    TEXT,
  action        VARCHAR(64) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  resource_id   UUID,
  payload       JSONB,
  ip_address    VARCHAR(45),
  correlation_id VARCHAR(64),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for tenant-scoped queries (most common access pattern)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_audit_log_tenant_created
  ON employee.hrms_audit_log (tenant_id, created_at DESC);

-- Index for resource-specific audit trail lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_audit_log_resource
  ON employee.hrms_audit_log (tenant_id, resource_type, resource_id);

-- Index for actor-based queries (who did what)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_audit_log_actor
  ON employee.hrms_audit_log (tenant_id, actor_id, created_at DESC);

COMMENT ON TABLE employee.hrms_audit_log IS 'Local audit trail for HR actions — e-Governance compliance (CERT-In, state service rules). Immutable append-only.';
