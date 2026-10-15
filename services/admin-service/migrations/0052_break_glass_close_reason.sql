-- Purpose: GAP-TENANT-ADMIN-BREAKGLASS-06. Record HOW a break-glass grant was
--   closed. The TTL sweeper closes an expired grant by setting closed_at, and the
--   list/detail status was derived as `closed_at IS NOT NULL -> "ended"`, so every
--   auto-expired grant read back as a normal "ended" one as soon as the sweeper ran
--   (<= 60s after expiry); "auto_expired" was only ever visible in that window, and
--   the nil-ish system actor leaked as "closed by". The close reason was passed to
--   repo.closeBreakGlass() but never stored.
-- Rollback: ALTER TABLE support.admin_break_glass_log DROP COLUMN IF EXISTS close_reason;
-- Affected services: admin-service
-- Table is already ENABLE + FORCE ROW LEVEL SECURITY with the tenant_isolation policy
-- (0005); a new nullable column changes neither.

SET lock_timeout = '5s';

ALTER TABLE support.admin_break_glass_log
  ADD COLUMN IF NOT EXISTS close_reason varchar(32);

-- Backfill: grants the sweeper closed carry the sweeper's system actor in updated_by;
-- every other closed grant was closed by an operator.
UPDATE support.admin_break_glass_log
   SET close_reason = CASE WHEN updated_by = '00000000-0000-0000-0000-000000000099'::uuid
                           THEN 'auto_expired' ELSE 'manual' END
 WHERE closed_at IS NOT NULL AND close_reason IS NULL;
