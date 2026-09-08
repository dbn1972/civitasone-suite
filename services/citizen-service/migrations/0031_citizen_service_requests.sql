-- COMP-002 — citizen-service migration 0031: real backing store for the
-- generic citizen service-request portal (POST /v1/citizen/requests and
-- friends), replacing the fabricated-success routes in modules/gap/routes.ts.
-- Additive, idempotent.
--
-- citizen_requests: one row per submitted request. citizen_request_status_history:
-- append-only status-transition trail, backing GET .../status's `history` field
-- and doubling as the audit-adjacent record of who changed what, when.
--
-- Referenced (as a still-simulated lookup) by modules/routing/routes.ts's
-- fetchRequestById/fetchExistingComplaints comments ("Integration with actual
-- DB is handled when citizen_requests table exists") — this migration is that
-- table; routing/domain wiring is done in the same PR.

CREATE SCHEMA IF NOT EXISTS requests AUTHORIZATION citizen_svc;

CREATE TABLE IF NOT EXISTS requests.citizen_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  citizen_id            uuid NOT NULL,
  category              varchar(64) NOT NULL DEFAULT 'general',
  subject               text NOT NULL,
  description           text NOT NULL,
  channel               varchar(24) NOT NULL DEFAULT 'portal',
  status                varchar(24) NOT NULL DEFAULT 'submitted'
                          CHECK (status IN ('submitted','under_review','in_progress','resolved','rejected','cancelled')),
  assignee_department   varchar(128),
  resolved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS requests.citizen_request_status_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  request_id    uuid NOT NULL,
  from_status   varchar(24),
  to_status     varchar(24) NOT NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_citizen_requests_tenant_status
  ON requests.citizen_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_citizen_requests_tenant_citizen
  ON requests.citizen_requests (tenant_id, citizen_id);
CREATE INDEX IF NOT EXISTS idx_citizen_requests_tenant_created
  ON requests.citizen_requests (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_citizen_request_status_history_request
  ON requests.citizen_request_status_history (tenant_id, request_id, created_at);

ALTER TABLE requests.citizen_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests.citizen_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON requests.citizen_requests;
CREATE POLICY tenant_isolation ON requests.citizen_requests
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

ALTER TABLE requests.citizen_request_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests.citizen_request_status_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON requests.citizen_request_status_history;
CREATE POLICY tenant_isolation ON requests.citizen_request_status_history
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

ALTER TABLE requests.citizen_requests OWNER TO citizen_svc;
ALTER TABLE requests.citizen_request_status_history OWNER TO citizen_svc;
