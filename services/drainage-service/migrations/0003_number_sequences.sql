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
-- database with rows can never hand out an in-use number, and never LOWER than
-- the sequence already is (so a re-run cannot rewind it and re-issue numbers).
-- Legacy codes (DRN-<epoch ms>-<4 digits>) can never equal a new
-- DRN-YYYY-NNNNNN code. Additive and idempotent.
--
-- NO FORCE ... FORCE: both source tables are FORCE ROW LEVEL SECURITY
-- (0001_initial.sql) and this migration runs as their OWNER (drainage_svc, a
-- non-superuser, so FORCE applies to it too) with no app.tenant_id GUC set.
-- Without lifting FORCE for the seed reads, MAX() sees ZERO rows and both
-- sequences would be seeded to 1 (re-issuing in-use numbers on a re-run). The
-- read-only seeds are cross-tenant by nature (the columns are globally UNIQUE);
-- FORCE is restored in the same transaction (house rule 4.3 backfill idiom).
-- Rollback:
--   DROP SEQUENCE IF EXISTS civitas_drainage.complaint_number_seq;
--   DROP SEQUENCE IF EXISTS civitas_drainage.hotspot_code_seq;
-- Affected services: drainage-service

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS civitas_drainage.complaint_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS civitas_drainage.hotspot_code_seq START 1;

ALTER TABLE civitas_drainage.drainage_complaints NO FORCE ROW LEVEL SECURITY;
ALTER TABLE civitas_drainage.drainage_hotspots   NO FORCE ROW LEVEL SECURITY;

SELECT setval('civitas_drainage.complaint_number_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM civitas_drainage.complaint_number_seq),
    COALESCE((SELECT MAX((regexp_match(complaint_number, '(\d+)$'))[1]::bigint)
                FROM civitas_drainage.drainage_complaints), 0) + 1), false);
SELECT setval('civitas_drainage.hotspot_code_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM civitas_drainage.hotspot_code_seq),
    COALESCE((SELECT MAX((regexp_match(hotspot_code, '(\d+)$'))[1]::bigint)
                FROM civitas_drainage.drainage_hotspots), 0) + 1), false);

ALTER TABLE civitas_drainage.drainage_complaints FORCE ROW LEVEL SECURITY;
ALTER TABLE civitas_drainage.drainage_hotspots   FORCE ROW LEVEL SECURITY;
COMMIT;
