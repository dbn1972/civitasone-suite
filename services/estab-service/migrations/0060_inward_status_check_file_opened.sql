-- UAT FQ9 #20: re-assert files.estab_inward.status CHECK with 'file_opened'.
-- 0031 defines estab_inward_status_check as
--   received | acknowledged | file_opened | attached | detached
-- and the files consumer sets 'file_opened' when a DAK is opened into a file. But 0031 adds the
-- constraint inside `EXCEPTION WHEN duplicate_object THEN NULL`, so a database that already carried a
-- constraint of that name from before 0031 kept the old definition. On UAT it is
--   received | acknowledged | attached | detached
-- (no 'file_opened'), so every open-file died on the CHECK, rolled back, and the DAK stayed 'received'.
-- This does not widen the domain: it reconciles drift back to 0031's documented set.
--
-- Safety: the drop and the re-add run in ONE statement (a DO block), so a lock timeout or any error
-- rolls both back and the table is never left without a status constraint (migrate-all runs psql
-- without --single-transaction). The constraint is added NOT VALID (enforced for new writes at once)
-- and then validated in a guarded sub-block: if an existing row violates it, the constraint stays
-- NOT VALID and a NOTICE is raised instead of failing. Idempotent. No data changes.
-- Rollback: none (this is 0031's own definition).
SET lock_timeout = '5s';

DO $$
BEGIN
  ALTER TABLE files.estab_inward DROP CONSTRAINT IF EXISTS estab_inward_status_check;
  ALTER TABLE files.estab_inward
    ADD CONSTRAINT estab_inward_status_check
    CHECK (status IN ('received', 'acknowledged', 'file_opened', 'attached', 'detached'))
    NOT VALID;
  BEGIN
    ALTER TABLE files.estab_inward VALIDATE CONSTRAINT estab_inward_status_check;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'estab_inward_status_check left NOT VALID: existing rows violate it (%)', SQLERRM;
  END;
END $$;
