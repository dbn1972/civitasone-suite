-- Purpose: replace the Date.now()+randomInt() human reference numbers with
-- Postgres SEQUENCEs (release blocker, #2167 evidence: 5 of 250 concurrent
-- rounds silently lost an accepted (202) hotspot because the UNIQUE-violation
-- retry re-ran with the SAME pre-generated hotspot_code).
--
-- The numbers are now allocated by the consumer with nextval() INSIDE the
-- transaction that inserts the row (src/shared/numbers.ts), so a retry
-- re-allocates and can never collide. Format: DRN-YYYY-000123 (complaints),
-- DRNH-YYYY-000123 (hotspots); sequences are GLOBAL (the columns are
-- globally UNIQUE), same shape as fire/animal-service 0002_number_sequences.
--
-- Seeding: one past the highest trailing digit run of any existing row so a
-- database with rows can never hand out an in-use number. Legacy codes
-- (DRN-<epoch ms>-<4 digits>) can never equal a new DRN-YYYY-NNNNNN code.
-- Additive and idempotent.
-- Rollback:
--   DROP SEQUENCE IF EXISTS civitas_drainage.complaint_number_seq;
--   DROP SEQUENCE IF EXISTS civitas_drainage.hotspot_code_seq;
-- Affected services: drainage-service

SET lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS civitas_drainage.complaint_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS civitas_drainage.hotspot_code_seq START 1;

SELECT setval('civitas_drainage.complaint_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(complaint_number, '(\d+)$'))[1]::bigint)
              FROM civitas_drainage.drainage_complaints), 0) + 1), false);
SELECT setval('civitas_drainage.hotspot_code_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(hotspot_code, '(\d+)$'))[1]::bigint)
              FROM civitas_drainage.drainage_hotspots), 0) + 1), false);
