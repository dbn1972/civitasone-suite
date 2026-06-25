-- helpdesk-service: HD1 (SLA-breach sweeper marker) + HD2 (inbound source linkage).
-- Additive + idempotent. Applied with helpdesk_svc on civitas_helpdesk.

-- HD1: one-shot "notified" markers so the SLA-breach sweeper fires at-risk and
-- breach notifications exactly once per ticket per stage. NULL = not yet sent.
ALTER TABLE helpdesk.tickets
  ADD COLUMN IF NOT EXISTS sla_at_risk_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_breached_notified_at timestamptz;

-- HD2: provenance for tickets auto-opened from a foreign producer event
-- (e.g. a missed telephony call). source_ref is the foreign aggregate id; the
-- partial unique index makes inbound linkage idempotent — one ticket per
-- (tenant, source, source_ref) even if the event is redelivered.
ALTER TABLE helpdesk.tickets
  ADD COLUMN IF NOT EXISTS source     varchar(32),
  ADD COLUMN IF NOT EXISTS source_ref varchar(128);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_source_ref
  ON helpdesk.tickets(tenant_id, source, source_ref)
  WHERE source IS NOT NULL AND source_ref IS NOT NULL;

-- Sweep index: find tickets that may have breached / be at risk and not yet
-- notified, scoped per tenant.
CREATE INDEX IF NOT EXISTS idx_tickets_sla_sweep
  ON helpdesk.tickets(tenant_id, status, created_at)
  WHERE status NOT IN ('closed','resolved');
