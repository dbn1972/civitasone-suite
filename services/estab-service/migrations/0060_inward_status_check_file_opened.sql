-- UAT FQ9 #20: re-assert files.estab_inward.status CHECK with 'file_opened'.
-- 0031 defines estab_inward_status_check as
--   received | acknowledged | file_opened | attached | detached
-- and the files consumer sets 'file_opened' when a DAK is opened into a file. But 0031 adds the
-- constraint inside `EXCEPTION WHEN duplicate_object THEN NULL`, so a database that already carried a
-- constraint of that name from before 0031 kept the old definition. On UAT it is
--   received | acknowledged | attached | detached
-- (no 'file_opened'), so every open-file died on the CHECK, rolled back, and the DAK stayed 'received'.
-- This does not widen the domain: it reconciles drift back to 0031's documented set.
-- Idempotent (drop-if-exists + add). No data changes. Rollback: none (this is 0031's own definition).
ALTER TABLE files.estab_inward DROP CONSTRAINT IF EXISTS estab_inward_status_check;
ALTER TABLE files.estab_inward
  ADD CONSTRAINT estab_inward_status_check
  CHECK (status IN ('received', 'acknowledged', 'file_opened', 'attached', 'detached'));
