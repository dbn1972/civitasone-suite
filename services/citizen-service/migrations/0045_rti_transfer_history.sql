-- citizen-service migration 0045 - GAP-CITIZEN-RTI-DETAIL-06: statutory trail of
-- RTI Act 2005 s.6(3) transfers. A transfer used to overwrite
-- rti.citizen_rti_requests.cpio_ref and leave no record of where the request
-- came from or who moved it, so the applicant's detail page could not show it.
-- Additive, idempotent. DDL only (no DML), so no NO FORCE / FORCE wrap needed.
--
-- from_authority / to_authority carry the cpio_ref values (rti.cpio_directory ids,
-- stored as text so a free-text authority is never rejected); the read side
-- resolves them to a directory name when it can.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS rti.citizen_rti_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  rti_id          uuid NOT NULL,
  from_authority  text NOT NULL,
  to_authority    text NOT NULL,
  transferred_by  uuid NOT NULL,
  transferred_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_rti_transfers_tenant_rti
  ON rti.citizen_rti_transfers (tenant_id, rti_id, transferred_at);

ALTER TABLE rti.citizen_rti_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rti.citizen_rti_transfers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rti.citizen_rti_transfers;
CREATE POLICY tenant_isolation ON rti.citizen_rti_transfers
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

ALTER TABLE rti.citizen_rti_transfers OWNER TO citizen_svc;

-- Rollback:
--   DROP TABLE IF EXISTS rti.citizen_rti_transfers;
