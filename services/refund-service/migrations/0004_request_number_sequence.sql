-- Purpose: V4-C-05 -- refund request_number was built from Date.now() % 999999:
-- the suffix repeats every ~16.7 minutes and two requests created in the same
-- millisecond (or across tenants) collided on the global UNIQUE request_number
-- (0001_initial.sql), losing the second request after the caller had already
-- received 202. Replaced by one Postgres SEQUENCE drawn with nextval() inside
-- the consumer transaction.
-- Scope: GLOBAL sequence (the column is global-unique; the old counter took no
-- tenant argument). Seeded one past the highest existing trailing number so
-- issued numbers are never re-issued; idempotent (never moves backwards on
-- re-apply). The seed read lifts FORCE RLS and restores it, since the table
-- owner otherwise sees zero rows without a tenant GUC.
-- Rollback:
--   DROP SEQUENCE IF EXISTS refund.request_number_seq;
--   (then revert the application change, which calls nextval on it)
-- Affected services: refund-service

SET lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS refund.request_number_seq START 1;

ALTER TABLE refund.refund_requests NO FORCE ROW LEVEL SECURITY;

SELECT setval(
  'refund.request_number_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM refund.request_number_seq),
    COALESCE((SELECT MAX((regexp_match(request_number, '(\d+)$'))[1]::bigint)
                FROM refund.refund_requests), 0)
  ) + 1,
  false);

ALTER TABLE refund.refund_requests FORCE ROW LEVEL SECURITY;
