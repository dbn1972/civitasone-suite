-- 0200_hrms_dedupe_employee_tenant_status_index.sql
--
-- GAP2-HRMS-WORKFORCE-02 (LOW, DB perf/tech-debt): employee.hrms_employees
-- carried THREE functionally identical btree indexes on (tenant_id, status),
-- each created by a separate perf pass with CREATE INDEX IF NOT EXISTS under a
-- different name, so none short-circuited the others:
--   * idx_hrms_emp_tenant               (0001_init.sql)          -- KEEP (canonical, oldest)
--   * idx_employees_tenant_status       (0002_perf_indexes.sql)  -- DROP (redundant)
--   * idx_hrms_employees_tenant_status  (0110_sprint10_uat_perf_indexes.sql) -- DROP (redundant)
-- Two of the three are pure write-amplification + storage overhead on a hot,
-- high-row-count tenant table (every insert/update/status-change maintains all
-- three) with zero added read benefit -- the three definitions are
-- interchangeable, so no query plan depends on a specific name.
--
-- Keep the canonical idx_hrms_emp_tenant (also (tenant_id, status), leading
-- column tenant_id) so hrms_employees still satisfies the tenant-index guard
-- (PERF-002: an RLS'd tenant table must keep a tenant_id-leading index).
--
-- Additive-safe and idempotent: DROP INDEX IF EXISTS takes only a brief
-- ACCESS EXCLUSIVE lock, bounded by lock_timeout; re-running is a no-op.
--
-- Rollback (restores the two redundant duplicates; the canonical
-- idx_hrms_emp_tenant stays):
--   CREATE INDEX IF NOT EXISTS idx_employees_tenant_status
--     ON employee.hrms_employees (tenant_id, status);
--   CREATE INDEX IF NOT EXISTS idx_hrms_employees_tenant_status
--     ON employee.hrms_employees (tenant_id, status);

SET lock_timeout = '5s';

-- Guarantee the canonical (tenant_id, status) index exists first, so this
-- migration leaves EXACTLY ONE such index regardless of which of the three
-- historical names a given cluster happened to have (clusters bootstrapped
-- from different migration subsets differ). Leading column tenant_id keeps
-- hrms_employees compliant with the tenant-index guard (PERF-002).
CREATE INDEX IF NOT EXISTS idx_hrms_emp_tenant
  ON employee.hrms_employees (tenant_id, status);

DROP INDEX IF EXISTS employee.idx_employees_tenant_status;
DROP INDEX IF EXISTS employee.idx_hrms_employees_tenant_status;
