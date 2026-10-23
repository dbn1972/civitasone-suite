-- citizen-service migration 0040 — bind a sandbox test run to the design it tested.
-- Additive, idempotent.
--
-- A passing run used to authorise submit for ANY later state of the draft: the
-- designer could pass the test, edit the fee/form/workflow, and still submit.
-- `definition_hash` is a SHA-256 of the design-relevant fields of the service
-- definition at the moment the run started; submit now requires the latest
-- passing run's hash to equal the definition's current hash. Runs recorded
-- before this migration have a NULL hash and are therefore stale (re-run once).

ALTER TABLE packs.sandbox_test_runs
  ADD COLUMN IF NOT EXISTS definition_hash varchar(64);
