-- 0005_permit_public_directory.sql
-- V4-B-06: GET /v1/building/permits/verify (public QR verification) was unreachable:
--  1. the route was not `config.public`, so authPlugin 401'd every anonymous caller; and
--  2. repo.findByVerificationCode selected straight from building.building_permits, which is
--     ENABLE + FORCE ROW LEVEL SECURITY with a tenant_id = app.tenant_id policy. An anonymous
--     request has no tenant, the GUC is never set, the predicate is NULL and every code
--     returned zero rows.
-- Same bug class and fix as fire-service 0003_noc_public_directory.sql and trade-service
-- 0002_licence_public_directory.sql: a NON-RLS directory table carrying ONLY the already-public
-- permit facts (permit number, status, issue/expiry). The permits repo keeps it in sync inside
-- the same transaction as every write that changes a permit's public state (issue, status
-- changes, renewal validity).
--
-- Existing permits are backfilled so QR codes already printed keep resolving. The backfill needs
-- NO FORCE for its duration (a table owner is otherwise subject to FORCE RLS and would see zero
-- rows); it runs inside one DO block, i.e. one transaction, so FORCE is restored atomically or the
-- whole statement rolls back.
--
-- Additive + idempotent.
-- Rollback: DROP TABLE IF EXISTS building.building_permit_directory;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS building.building_permit_directory (
  verification_code varchar(64) PRIMARY KEY,
  tenant_id         uuid NOT NULL,
  permit_id         uuid NOT NULL,
  permit_number     varchar(64) NOT NULL,
  status            varchar(32) NOT NULL,
  issued_at         timestamptz,
  valid_until       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS building_permit_directory_permit_idx
  ON building.building_permit_directory (permit_id);

-- Intentionally NO RLS on this table (see header): public facts only.

DO $$
BEGIN
  ALTER TABLE building.building_permits NO FORCE ROW LEVEL SECURITY;
  INSERT INTO building.building_permit_directory
    (verification_code, tenant_id, permit_id, permit_number, status, issued_at, valid_until)
  SELECT verification_code, tenant_id, id, permit_number, status, issued_at, valid_until
    FROM building.building_permits
  ON CONFLICT (verification_code) DO NOTHING;
  ALTER TABLE building.building_permits FORCE ROW LEVEL SECURITY;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'building_svc') THEN
    GRANT SELECT, INSERT, UPDATE ON building.building_permit_directory TO building_svc;
  END IF;
END
$$;
