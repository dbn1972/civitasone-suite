-- TX-013: audit.hr_action_log has never existed, so hrms-service's
-- shared/audit.ts writeAuditLog() (fire-and-forget, catch-and-log-error only)
-- has silently failed on EVERY mutating HRMS request since it was written --
-- `[audit] write failed / relation "audit.hr_action_log" does not exist` on
-- every call, invisible until REL-001 unblocked the `Tests` job. This is a
-- DIFFERENT table from employee.hrms_audit_log (0109_audit_log_table.sql,
-- a Drizzle-schema-attached table used elsewhere) -- do not conflate the two.
-- Columns match the exact INSERT in src/shared/audit.ts:52-77.
-- Purpose: create audit.hr_action_log so the HRMS audit trail actually persists.
-- Rollback: DROP TABLE IF EXISTS audit.hr_action_log; DROP SCHEMA IF EXISTS audit;
-- Affected services: hrms-service (applied with hrms_svc role on civitas_hrms)

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.hr_action_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  -- TEXT, not UUID: ctx.actorId comes straight from the verified token's
  -- `sub` claim. Real Keycloak subjects are UUIDs, but several dev/test
  -- tokens and some service-account paths use human-readable strings (e.g.
  -- "s9-user-001") -- a stricter UUID column would make writeAuditLog fail
  -- (caught, logged, silent) for exactly those actors, reintroducing a
  -- narrower version of the bug this migration exists to fix.
  actor_id       TEXT,
  actor_type     TEXT,
  actor_roles    TEXT[] NOT NULL DEFAULT '{}',
  method         TEXT NOT NULL,
  path           TEXT NOT NULL,
  entity_type    TEXT,
  entity_id      UUID,
  status_code    INTEGER NOT NULL,
  request_id     TEXT,
  ip_addr        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tenant-scoped listing (most common access pattern), mirrors
-- idx_hrms_audit_log_tenant_created in 0109_audit_log_table.sql.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hr_action_log_tenant_created
  ON audit.hr_action_log (tenant_id, created_at DESC);

-- Entity-specific audit trail lookups.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hr_action_log_entity
  ON audit.hr_action_log (tenant_id, entity_type, entity_id);

-- Actor-based queries (who did what).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hr_action_log_actor
  ON audit.hr_action_log (tenant_id, actor_id, created_at DESC);

COMMENT ON TABLE audit.hr_action_log IS 'Per-request audit trail for HRMS mutating actions, written fire-and-forget by shared/audit.ts writeAuditLog(). TX-013.';

-- RLS: same convention as the rest of hrms-service (employee.current_tenant_id(),
-- ENABLE + FORCE + tenant_isolation_policy -- see 0034_rls_full_tenant_isolation.sql
-- and 0123_rls_completeness.sql). This is a per-tenant audit trail, so it must be
-- isolated like every other tenant-scoped table.
--
-- NOTE: writeAuditLog's INSERT is a bare (non-transactional) sqlClient call, so it
-- must set app.tenant_id itself before inserting (see the accompanying audit.ts
-- change, which wraps the insert in @civitasone/db's withRawTenantGuc) -- otherwise
-- FORCE RLS's WITH CHECK fails CLOSED for every write and the "fix" just swaps one
-- silent failure for another. See packages/db/src/raw-tenant-guc.ts's doc comment
-- for the general shape of this gap (also hit by helpdesk-service, crm-service,
-- estab-service and payroll-service).
ALTER TABLE audit.hr_action_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.hr_action_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON audit.hr_action_log;
DROP POLICY IF EXISTS tenant_isolation ON audit.hr_action_log;
CREATE POLICY tenant_isolation_policy ON audit.hr_action_log
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());
