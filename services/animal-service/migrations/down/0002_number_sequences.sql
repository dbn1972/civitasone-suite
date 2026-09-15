-- Down-migration for 0002_number_sequences.sql — REL-020.
--
-- Drops the two global numbering sequences the paired up-migration created,
-- formalizing the SQL its own header comment already specified as the
-- rollback ("-- Rollback: DROP SEQUENCE IF EXISTS animal.complaint_number_seq;
-- DROP SEQUENCE IF EXISTS animal.registration_number_seq;") into a real,
-- tooled, verified down-migration.
--
-- Run via scripts/ops/migrate-rollback.sh, never by hand: that tool wraps
-- this file in a single transaction (psql -1 -v ON_ERROR_STOP=1).
--
-- CAUTION for a real production rollback (not applicable to the disposable
-- verification cluster this was tested against): dropping these sequences
-- reintroduces the Date.now() % 999999 collision bug the up-migration fixed
-- (see that migration's header) unless the paired app-code change
-- (registration/repo.ts's nextComplaintNumber / nextRegistrationNumber,
-- which call nextval() on these sequences) is rolled back in the same
-- deploy — otherwise every complaint/registration submission errors
-- immediately with "relation ... does not exist".
--
-- See scripts/ops/MIGRATION-ROLLBACK.md for the full procedure.

SET lock_timeout = '5s';

DROP SEQUENCE IF EXISTS animal.complaint_number_seq;
DROP SEQUENCE IF EXISTS animal.registration_number_seq;
