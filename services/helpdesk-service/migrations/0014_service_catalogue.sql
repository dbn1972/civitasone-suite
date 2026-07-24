-- helpdesk-service: SVC-129 Service catalogue & support SLA.
-- Adds the request/service catalogue: offerings (with request-form schema +
-- fulfilment workflow), OLA / underpinning-contract tracking (internal targets
-- behind an SLA), self-service service requests (each creating a fulfilment item
-- + linked ticket), maker-checker approvals, stage transition events, and an
-- SLA-breach escalation marker for reporting.
--
-- Additive + idempotent (CREATE ... IF NOT EXISTS). Safe to re-run.
-- Rollback (reverse dependency order):
--   DROP TABLE IF EXISTS helpdesk.request_stage_events;
--   DROP TABLE IF EXISTS helpdesk.request_approvals;
--   DROP TABLE IF EXISTS helpdesk.service_requests;
--   DROP TABLE IF EXISTS helpdesk.catalogue_olas;
--   DROP TABLE IF EXISTS helpdesk.catalogue_offerings;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

-- ── Catalogue offerings ─────────────────────────────────────────────────────
-- A catalogue offering IS a request type: it carries the request form schema,
-- the fulfilment workflow (ordered stages), whether an approval step is required
-- (maker-checker), and the SLA policy it maps to (reuses helpdesk.sla_policies).
CREATE TABLE IF NOT EXISTS helpdesk.catalogue_offerings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(128) NOT NULL DEFAULT 'general',
  description TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  sla_policy_id UUID,
  approval_required BOOLEAN NOT NULL DEFAULT false,
  request_form_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
  fulfilment_stages JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_priority VARCHAR(24) NOT NULL DEFAULT 'Medium',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1,
  CONSTRAINT chk_catalogue_offerings_status CHECK (status IN ('active','retired'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalogue_offerings_tenant_name
  ON helpdesk.catalogue_offerings(tenant_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_catalogue_offerings_tenant_status
  ON helpdesk.catalogue_offerings(tenant_id, status);

-- ── OLA / underpinning contracts ────────────────────────────────────────────
-- Internal targets that sit BEHIND a customer-facing SLA. kind='ola' for an
-- internal Operational Level Agreement, kind='uc' for an external Underpinning
-- Contract (supplier). target_minutes is the internal resolution target.
CREATE TABLE IF NOT EXISTS helpdesk.catalogue_olas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  offering_id UUID NOT NULL,
  name VARCHAR(200) NOT NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'ola',
  provider VARCHAR(200) NOT NULL,
  target_minutes INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1,
  CONSTRAINT chk_catalogue_olas_kind CHECK (kind IN ('ola','uc')),
  CONSTRAINT chk_catalogue_olas_target CHECK (target_minutes > 0)
);
CREATE INDEX IF NOT EXISTS idx_catalogue_olas_tenant_offering
  ON helpdesk.catalogue_olas(tenant_id, offering_id);

-- ── Service requests (fulfilment items) ─────────────────────────────────────
-- A raised request from the self-service portal. Each request creates a linked
-- ticket (ticket_id) and tracks its own fulfilment stage + SLA status.
CREATE TABLE IF NOT EXISTS helpdesk.service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  offering_id UUID NOT NULL,
  ticket_id UUID,
  requested_by UUID NOT NULL,
  form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(24) NOT NULL DEFAULT 'pending_fulfilment',
  current_stage VARCHAR(64),
  sla_policy_id UUID,
  response_deadline TIMESTAMPTZ,
  resolution_deadline TIMESTAMPTZ,
  sla_status VARCHAR(16) NOT NULL DEFAULT 'within_sla',
  breach_escalated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1,
  CONSTRAINT chk_service_requests_status CHECK (
    status IN ('pending_approval','approved','rejected','pending_fulfilment','in_fulfilment','fulfilled','cancelled')
  ),
  CONSTRAINT chk_service_requests_sla_status CHECK (sla_status IN ('within_sla','at_risk','breached'))
);
CREATE INDEX IF NOT EXISTS idx_service_requests_tenant_status
  ON helpdesk.service_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_service_requests_tenant_requester
  ON helpdesk.service_requests(tenant_id, requested_by);
CREATE INDEX IF NOT EXISTS idx_service_requests_tenant_offering
  ON helpdesk.service_requests(tenant_id, offering_id);

-- ── Request approvals (maker-checker) ───────────────────────────────────────
-- One approval decision per checker action. The checker (decided_by) is enforced
-- in the domain layer to differ from the maker (service_requests.requested_by).
CREATE TABLE IF NOT EXISTS helpdesk.request_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  request_id UUID NOT NULL,
  decision VARCHAR(16) NOT NULL,
  decided_by UUID NOT NULL,
  comment TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  CONSTRAINT chk_request_approvals_decision CHECK (decision IN ('approved','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_request_approvals_request
  ON helpdesk.request_approvals(tenant_id, request_id);

-- ── Request stage events (fulfilment audit trail) ───────────────────────────
CREATE TABLE IF NOT EXISTS helpdesk.request_stage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  request_id UUID NOT NULL,
  from_stage VARCHAR(64),
  to_stage VARCHAR(64) NOT NULL,
  actor_id UUID NOT NULL,
  note TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_request_stage_events_request
  ON helpdesk.request_stage_events(tenant_id, request_id);

-- ── RLS: full tenant isolation (USING + WITH CHECK), mirrors migration 0006 ──
CREATE OR REPLACE FUNCTION helpdesk.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'catalogue_offerings','catalogue_olas','service_requests',
    'request_approvals','request_stage_events'
  ] LOOP
    EXECUTE format('ALTER TABLE helpdesk.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE helpdesk.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON helpdesk.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON helpdesk.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_policy ON helpdesk.%I
         USING (tenant_id = helpdesk.current_tenant_id())
         WITH CHECK (tenant_id = helpdesk.current_tenant_id())', t);
  END LOOP;
END $$;

-- ── Extend tickets.source allowlist for catalogue-raised requests ────────────
-- Self-service catalogue requests open a linked ticket tagged source='catalogue'.
-- Additive: widen the existing CHECK to include the new provenance value.
ALTER TABLE helpdesk.tickets DROP CONSTRAINT IF EXISTS tickets_source_check;
ALTER TABLE helpdesk.tickets ADD CONSTRAINT tickets_source_check
  CHECK (source IS NULL OR source::text = ANY (ARRAY['telephony','crm','catalogue']::text[]));
