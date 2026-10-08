-- citizen-service migration 0035 — GAP-CITIZEN-RTI-03: CPIO / public-authority
-- directory so an applicant can pick the Central Public Information Officer by
-- name/authority instead of hand-typing a raw UUID. Additive, idempotent.
--
-- rti.cpio_directory: one row per CPIO (Central/State Public Information
-- Officer) a citizen may route an RTI to. `cpio_ref` on rti.citizen_rti_requests
-- continues to carry the directory row id (an opaque uuid) — no schema change on
-- the requests table is needed; this is the lookup source behind the picker.
--
-- Mirrors the tenant-isolation + ownership columns of the other rti tables and
-- the portal.current_tenant_id() RLS pattern (see 0007/0015).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS rti.cpio_directory (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  name            text NOT NULL,
  designation     text,
  public_authority text NOT NULL,
  department      text,
  email           text,
  phone           text,
  status          varchar(16) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

-- Lookup by (tenant, authority) and a trigram-friendly name search.
CREATE INDEX IF NOT EXISTS idx_cpio_directory_tenant_authority
  ON rti.cpio_directory (tenant_id, public_authority);
CREATE INDEX IF NOT EXISTS idx_cpio_directory_tenant_status
  ON rti.cpio_directory (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_cpio_directory_tenant_name
  ON rti.cpio_directory (tenant_id, lower(name));

ALTER TABLE rti.cpio_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE rti.cpio_directory FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rti.cpio_directory;
CREATE POLICY tenant_isolation ON rti.cpio_directory
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

ALTER TABLE rti.cpio_directory OWNER TO citizen_svc;

-- Rollback:
--   DROP TABLE IF EXISTS rti.cpio_directory;
