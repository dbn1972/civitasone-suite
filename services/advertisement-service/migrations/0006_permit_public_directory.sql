-- 0006_permit_public_directory.sql
-- V4-B-06: GET /v1/advertisement/permits/verify (public QR verification) was unreachable:
--  1. the route was not `config.public`, so authPlugin 401'd every anonymous caller; and
--  2. repo.findByVerificationCode selected straight from adv_permits.adv_permits, which is
--     ENABLE + FORCE ROW LEVEL SECURITY with a tenant_id = app.tenant_id policy. An anonymous
--     request has no tenant, the GUC is never set, the predicate is NULL and every code
--     returned zero rows.
-- Same bug class and same fix as fire-service 0003_noc_public_directory.sql and
-- trade-service 0002_licence_public_directory.sql: a small NON-RLS directory table carrying ONLY
-- the already-public permit facts (no location, applicant or application identifiers beyond the
-- opaque ids). The permits repo keeps it in sync inside the same transaction as every write that
-- changes a permit's public state (issue, suspend/cancel status changes, renewal validity).
--
-- Existing permits are backfilled below so QR codes already printed keep resolving. The backfill
-- needs NO FORCE for its duration (a table owner is otherwise subject to FORCE RLS and would see
-- zero rows); it runs inside one DO block, i.e. one transaction, so FORCE is restored atomically
-- or the whole statement rolls back.
--
-- Additive + idempotent.
-- Rollback: DROP TABLE IF EXISTS adv_permits.adv_permit_directory;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS adv_permits.adv_permit_directory (
  verification_code  varchar(32) PRIMARY KEY,
  tenant_id          uuid NOT NULL,
  permit_id          uuid NOT NULL,
  permit_number      varchar(64) NOT NULL,
  advertisement_type varchar(32) NOT NULL,
  status             varchar(32) NOT NULL,
  issued_at          timestamptz,
  valid_from         date,
  valid_until        date,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS adv_permit_directory_permit_idx
  ON adv_permits.adv_permit_directory (permit_id);

-- Intentionally NO RLS on this table (see header): public facts only.

DO $$
BEGIN
  ALTER TABLE adv_permits.adv_permits NO FORCE ROW LEVEL SECURITY;
  INSERT INTO adv_permits.adv_permit_directory
    (verification_code, tenant_id, permit_id, permit_number, advertisement_type, status, issued_at, valid_from, valid_until)
  SELECT verification_code, tenant_id, id, permit_number, advertisement_type, status, issued_at, valid_from, valid_until
    FROM adv_permits.adv_permits
  ON CONFLICT (verification_code) DO NOTHING;
  ALTER TABLE adv_permits.adv_permits FORCE ROW LEVEL SECURITY;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'advertisement_svc') THEN
    GRANT SELECT, INSERT, UPDATE ON adv_permits.adv_permit_directory TO advertisement_svc;
  END IF;
END
$$;
