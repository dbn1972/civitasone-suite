-- Migration 0093: backfill release_started_at for legacy `processing` PFMS batches
--
-- 0092 added payments.finance_pfms.release_started_at, the clock the stuck-release sweeper uses. A treasury batch that was
-- already in `processing` when 0092 shipped has no value. The sweeper (findStuckViaScanner / markPfmsSendUnknown) now uses
-- COALESCE(release_started_at, updated_at), so it sweeps such rows WITHOUT this backfill. This migration is therefore
-- cosmetic: it just makes the stored value explicit.
--
-- NOTE: payments.finance_pfms has FORCE ROW LEVEL SECURITY and no tenant GUC is set while a migration runs, so this UPDATE
-- only takes effect when run by an RLS-bypassing role (the database owner / superuser); as finance_svc it matches 0 rows,
-- which is harmless precisely because the sweeper does not rely on it.
--
-- Only treasury-channel batches: e-Kuber adapter rows also use `processing` but are not releases and must stay out of the
-- sweeper. Idempotent: once set, the IS NULL guard matches nothing. released_by is NOT backfilled (unknown), so maker-checker
-- on resolving such a row has no releaser to compare against.
-- Rollback: none needed (the column was NULL; setting it back is harmless data loss of an estimate only).
SET lock_timeout = '5s';

UPDATE payments.finance_pfms
   SET release_started_at = updated_at
 WHERE submission_status = 'processing'
   AND channel = 'treasury_batch'
   AND release_started_at IS NULL;
