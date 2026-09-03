-- Purpose: files/modules/esign/schema.ts and files/modules/referencing/schema.ts
-- (Drizzle) declare columns that were never added to the actual tables in any
-- migration — pure schema drift, introduced in 76823be6 ("fix: critical
-- production gaps — try/catch consumers, zod validation, audit events,
-- pagination, schema columns") which updated the Drizzle schemas but missed
-- the corresponding migrations for these two tables.
--
-- files.estab_signature (created in 0016_esign.sql) is missing `version`,
-- `created_by`, `updated_by` — all three are read/written by
-- src/modules/esign/repo.ts + consumer.ts on every signature insert and
-- select. Effect on a fresh cluster (reproduced before this fix): every
-- e-signature attempt (Aadhaar eSign and DSC) fails with
-- `column "version" does not exist` inside the consumer transaction, so it
-- rolls back and dead-letters after retries — legal e-signing (IT Act 2000
-- §3A, H1) has been completely non-functional since that commit, and the
-- mandatory-signing dispatch gate can never see a valid signature either.
--
-- files.estab_reference (created in 0024_structured_referencing.sql) is
-- missing `version` — read on every SELECT against the table (R7 structured
-- referencing), so every list/insert/delete of a reference 500s.
--
-- Both are additive, nullable-safe (NOT NULL DEFAULT, so existing rows are
-- backfilled by the DEFAULT with no manual UPDATE needed), forward-only.
--
-- Rollback: ALTER TABLE ... DROP COLUMN IF EXISTS <col> for each column below.
SET lock_timeout = '5s';

ALTER TABLE files.estab_signature
  ADD COLUMN IF NOT EXISTS version    integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- created_by/updated_by are NOT NULL in the Drizzle schema (every insert path
-- supplies both — see esign/consumer.ts), but adding a NOT NULL column
-- without a default would fail if any row already exists without one. Backfill
-- any pre-existing rows from signer_id (the only actor identity already on the
-- table) before tightening the constraint, so this migration is safe to run
-- against a cluster that already has signature rows.
UPDATE files.estab_signature
   SET created_by = COALESCE(created_by, signer_id),
       updated_by = COALESCE(updated_by, signer_id)
 WHERE created_by IS NULL OR updated_by IS NULL;

ALTER TABLE files.estab_signature
  ALTER COLUMN created_by SET NOT NULL,
  ALTER COLUMN updated_by SET NOT NULL;

ALTER TABLE files.estab_reference
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
