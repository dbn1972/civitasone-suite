-- Purpose: replace the Date.now() human reference numbers (SWM-/SWMG-/SWMR-/SWMT-/SWMH-<epoch ms>)
-- with Postgres SEQUENCEs. Two requests in the same millisecond produced the same number, and the
-- number was generated in the route handler and carried in the command payload, so a retried
-- command replayed a stale number. Same defect and fix as drainage-service 0003 (#2182).
--
-- The numbers are now allocated by the consumer with nextval() INSIDE the transaction that inserts
-- the row (src/shared/numbers.ts), so a retry re-allocates and can never collide. Format:
-- SWM-YYYY-000123 (complaints), SWMG- (bulk generators), SWMR- (collection requests),
-- SWMT- (field tasks), SWMH- (hotspots); year in IST. The sequences are GLOBAL (not per tenant),
-- so a number is unique across tenants. No UNIQUE constraint existed on these columns and none is
-- added here: legacy rows may already hold duplicate Date.now() values, which would make the
-- constraint fail to create; the sequence makes a collision impossible by construction.
--
-- Seeding: one past the highest trailing digit run of any existing row, and never LOWER than the
-- sequence already is (so a re-run cannot rewind it and re-issue numbers). Additive and idempotent.
--
-- NO FORCE ... FORCE: all five tables are FORCE ROW LEVEL SECURITY (0001_swm_schema.sql) and this
-- migration runs as their OWNER (a non-superuser, so FORCE applies to it too) with no app.tenant_id
-- GUC set. Without lifting FORCE for the seed reads, MAX() sees ZERO rows and the sequences would
-- be seeded to 1 (re-issuing in-use numbers on a re-run). The read-only seeds are cross-tenant by
-- nature; FORCE is restored in the same transaction (house rule 4.3 backfill idiom).
-- Rollback:
--   DROP SEQUENCE IF EXISTS civitas_swm.complaint_number_seq;
--   DROP SEQUENCE IF EXISTS civitas_swm.registration_number_seq;
--   DROP SEQUENCE IF EXISTS civitas_swm.request_number_seq;
--   DROP SEQUENCE IF EXISTS civitas_swm.task_number_seq;
--   DROP SEQUENCE IF EXISTS civitas_swm.hotspot_code_seq;
-- Affected services: swm-service

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS civitas_swm.complaint_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS civitas_swm.registration_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS civitas_swm.request_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS civitas_swm.task_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS civitas_swm.hotspot_code_seq START 1;

ALTER TABLE civitas_swm.swm_complaints NO FORCE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_bulk_generators NO FORCE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_collection_requests NO FORCE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_field_tasks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_hotspots NO FORCE ROW LEVEL SECURITY;

SELECT setval('civitas_swm.complaint_number_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM civitas_swm.complaint_number_seq),
    COALESCE((SELECT MAX((regexp_match(complaint_number, '(\d+)$'))[1]::bigint)
                FROM civitas_swm.swm_complaints), 0) + 1), false);
SELECT setval('civitas_swm.registration_number_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM civitas_swm.registration_number_seq),
    COALESCE((SELECT MAX((regexp_match(registration_number, '(\d+)$'))[1]::bigint)
                FROM civitas_swm.swm_bulk_generators), 0) + 1), false);
SELECT setval('civitas_swm.request_number_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM civitas_swm.request_number_seq),
    COALESCE((SELECT MAX((regexp_match(request_number, '(\d+)$'))[1]::bigint)
                FROM civitas_swm.swm_collection_requests), 0) + 1), false);
SELECT setval('civitas_swm.task_number_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM civitas_swm.task_number_seq),
    COALESCE((SELECT MAX((regexp_match(task_number, '(\d+)$'))[1]::bigint)
                FROM civitas_swm.swm_field_tasks), 0) + 1), false);
SELECT setval('civitas_swm.hotspot_code_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM civitas_swm.hotspot_code_seq),
    COALESCE((SELECT MAX((regexp_match(hotspot_code, '(\d+)$'))[1]::bigint)
                FROM civitas_swm.swm_hotspots), 0) + 1), false);

ALTER TABLE civitas_swm.swm_complaints FORCE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_bulk_generators FORCE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_collection_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_field_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_hotspots FORCE ROW LEVEL SECURITY;
COMMIT;
