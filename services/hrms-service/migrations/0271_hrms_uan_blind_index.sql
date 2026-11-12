-- 0271_hrms_uan_blind_index.sql
--
-- Blind index for the (now encrypted, migration 0268) UAN: employee.hrms_employees.uan_bidx holds
-- "<keyid>.<hex HMAC-SHA256(tenant, uan)>" so an exact-match lookup and the bulk-import duplicate check can run
-- WITHOUT decrypting every row (see src/shared/blind-index.ts). NULL until the row is written or backfilled
-- (scripts/backfill-uan-encryption.ts); nothing reads it unless HRMS_UAN_BLIND_INDEX_ENABLED=true AND the tenant is fully
-- backfilled, so this migration changes no behaviour by itself.
--
-- Additive and idempotent. The index is deliberately NOT unique: a UAN belongs to a person for life, so a re-hired
-- person legitimately appears on two employee records of the same tenant; duplicate policy stays in the application.
--
-- Rollback: DROP INDEX IF EXISTS employee.idx_hrms_employees_tenant_uan_bidx;
--           ALTER TABLE employee.hrms_employees DROP COLUMN IF EXISTS uan_bidx;

SET lock_timeout = '5s';

ALTER TABLE employee.hrms_employees ADD COLUMN IF NOT EXISTS uan_bidx text;

CREATE INDEX IF NOT EXISTS idx_hrms_employees_tenant_uan_bidx
  ON employee.hrms_employees (tenant_id, uan_bidx)
  WHERE uan_bidx IS NOT NULL;
