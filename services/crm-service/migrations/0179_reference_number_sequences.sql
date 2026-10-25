-- Purpose: replace the Date.now()-based human reference numbers for service
-- requests (SRQ/YYYY/xxxxxx) and RTI requests (RTI/YYYY/DEPT/xxxxxx) with
-- Postgres SEQUENCEs. The old suffix was the last 6 base-36 characters of the
-- millisecond clock, so two creates in the same millisecond collided; on
-- crm.rti_requests (reference_no UNIQUE NOT NULL, 0081) the second citizen got a
-- 500, and on crm.service_requests (no constraint) two requests silently
-- shared one number.
--
-- The numbers are now allocated with nextval() INSIDE the transaction that
-- inserts the row (src/shared/reference-numbers.ts), so a retry re-allocates
-- and can never collide. Format is unchanged in shape (SRQ/2026/000123,
-- RTI/2026/DEPT/000123), the year is now the IST year. Sequences are GLOBAL
-- (rti_requests.reference_no is globally UNIQUE).
--
-- Seeding: one past the highest all-digit counter of any existing row, and
-- never LOWER than the sequence already is (so a re-run cannot rewind it and
-- re-issue numbers). Legacy refs with a base-36 suffix containing a letter can
-- never equal a new all-digit ref; legacy refs with an all-digit suffix are
-- covered by the seed. Additive and idempotent.
--
-- NO FORCE ... FORCE: both tables are FORCE ROW LEVEL SECURITY (0092) and this
-- migration runs as their OWNER with no app.tenant_id GUC. Without lifting
-- FORCE for the seed reads, MAX() sees ZERO rows and both sequences would be
-- seeded to 1. The read-only seeds are cross-tenant by nature; FORCE is
-- restored in the same transaction (same idiom as 0097).
-- Rollback:
--   DROP SEQUENCE IF EXISTS crm.service_request_ref_seq;
--   DROP SEQUENCE IF EXISTS crm.rti_ref_seq;
-- Affected services: crm-service (service-requests, rti modules)

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS crm.service_request_ref_seq START 1;
CREATE SEQUENCE IF NOT EXISTS crm.rti_ref_seq START 1;

ALTER TABLE crm.service_requests NO FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.rti_requests     NO FORCE ROW LEVEL SECURITY;

SELECT setval('crm.service_request_ref_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM crm.service_request_ref_seq),
    COALESCE((SELECT MAX((regexp_match(reference_no, '^SRQ/\d{4}/(\d{1,15})$'))[1]::bigint)
                FROM crm.service_requests), 0) + 1), false);
SELECT setval('crm.rti_ref_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM crm.rti_ref_seq),
    COALESCE((SELECT MAX((regexp_match(reference_no, '^RTI/\d{4}/[A-Z0-9]+/(\d{1,15})$'))[1]::bigint)
                FROM crm.rti_requests), 0) + 1), false);

ALTER TABLE crm.service_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.rti_requests     FORCE ROW LEVEL SECURITY;
COMMIT;
