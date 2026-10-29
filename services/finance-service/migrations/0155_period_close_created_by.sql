-- 0155_period_close_created_by.sql
-- UAT g3 #1: every period-close / journal / GET /periods call 500d on the UAT DB because
-- gl.finance_period_close had no created_by column although period-close/schema.ts selects and
-- inserts it. 0005_world_class.sql creates the column on a fresh DB, but hand-built / drifted
-- environments ended up without it (0006's CREATE TABLE IF NOT EXISTS no-ops against an existing
-- table). UAT was patched by hand; this migration makes every environment converge.
-- Additive + idempotent. The nil-UUID default is the same defensive sentinel as 0079 (pre-existing
-- rows have no recorded maker; every writer supplies the real actor explicitly). No money columns.
-- Rollback: ALTER TABLE gl.finance_period_close DROP COLUMN IF EXISTS created_by;

SET lock_timeout = '5s';

ALTER TABLE gl.finance_period_close
  ADD COLUMN IF NOT EXISTS created_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
