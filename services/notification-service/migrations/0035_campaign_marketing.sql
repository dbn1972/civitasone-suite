-- BRD §7.9 Campaign & Source Management (MK-001, MK-004) — marketing extension.
--
-- Purpose: the `bulk` module already models campaigns (0002) but only as a
--          send-fan-out object. MK-001/MK-004 need a campaign to also carry an
--          objective, an audience link, a BUDGET, and — after the send — the
--          RESPONSES and ATTRIBUTED REVENUE that let ROI be computed. This file
--          adds those columns to bulk.campaigns and a new bulk.campaign_responses
--          table.
--
-- Money:   budget_minor / actual_cost_minor / revenue_minor are bigint PAISE
--          (minor units). NO floating point ever touches these values — the
--          service reads and writes them as strings/bigint end-to-end. bigint,
--          not numeric, because they are integer minor units with no fractional
--          part; the application does the ROI arithmetic in BigInt.
--
-- RLS:     mirrors the existing bulk tables verbatim — ENABLE + FORCE ROW LEVEL
--          SECURITY and a `tenant_isolation_policy` keyed on
--          templates.current_tenant_id() (0006/0007), which reads the
--          app.tenant_id GUC. Under the NOBYPASSRLS notification_svc role a read
--          without that GUC set returns zero rows (fail closed).
--
-- Rollback: ALTER TABLE bulk.campaigns
--             DROP COLUMN IF EXISTS objective, DROP COLUMN IF EXISTS audience_segment_id,
--             DROP COLUMN IF EXISTS budget_minor, DROP COLUMN IF EXISTS currency,
--             DROP COLUMN IF EXISTS actual_cost_minor;
--           DROP TABLE IF EXISTS bulk.campaign_responses;
--
-- Safety:  purely additive. New nullable/defaulted columns and one new table —
--          no existing column, constraint or index is altered, so no deployed
--          code can break and no existing row becomes invalid. Fully idempotent:
--          ADD COLUMN / CREATE TABLE / CREATE INDEX use IF NOT EXISTS, ADD
--          CONSTRAINT (no IF NOT EXISTS) is guarded on pg_constraint, and the
--          policy is guarded on pg_policies. `scripts/dev/migrate-all.mjs` keeps
--          no applied-migration ledger and re-runs every file, so a re-run must
--          be a no-op.
--
-- Affected services: notification-service (bulk module).
SET lock_timeout = '5s';

-- ── bulk.campaigns: marketing columns ─────────────────────────────────────────

ALTER TABLE bulk.campaigns
  ADD COLUMN IF NOT EXISTS objective          text,
  ADD COLUMN IF NOT EXISTS audience_segment_id uuid,
  ADD COLUMN IF NOT EXISTS budget_minor       bigint      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency           char(3)     NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS actual_cost_minor  bigint      NOT NULL DEFAULT 0;

-- Non-negative money guards — a budget or cost can never be negative paise.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaigns_budget_minor_nonneg') THEN
    ALTER TABLE bulk.campaigns ADD CONSTRAINT chk_campaigns_budget_minor_nonneg CHECK (budget_minor >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaigns_actual_cost_minor_nonneg') THEN
    ALTER TABLE bulk.campaigns ADD CONSTRAINT chk_campaigns_actual_cost_minor_nonneg CHECK (actual_cost_minor >= 0);
  END IF;
END
$$;

-- audience_segment_id is a LOGICAL link to a segment (segments module). No hard
-- FK — a campaign can outlive the segment it was targeted from, and cross-module
-- FKs are avoided here — but the lookup is indexed, tenant-first.
CREATE INDEX IF NOT EXISTS idx_campaigns_audience_segment
  ON bulk.campaigns (tenant_id, audience_segment_id);

-- ── bulk.campaign_responses ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bulk.campaign_responses (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  campaign_id   uuid        NOT NULL REFERENCES bulk.campaigns(id),
  -- The CRM subject that responded/converted. No FK: leads/contacts/accounts
  -- live in another service (crm-service), so referential integrity is logical.
  subject_type  varchar(16) NOT NULL,
  subject_id    uuid        NOT NULL,
  responded     boolean     NOT NULL DEFAULT true,
  converted     boolean     NOT NULL DEFAULT false,
  -- Attributed revenue in PAISE (minor units). bigint, integer arithmetic only.
  revenue_minor bigint      NOT NULL DEFAULT 0,
  responded_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        NOT NULL,
  updated_by    uuid        NOT NULL,
  version       integer     NOT NULL DEFAULT 1
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaign_responses_subject_type') THEN
    ALTER TABLE bulk.campaign_responses
      ADD CONSTRAINT chk_campaign_responses_subject_type
      CHECK (subject_type IN ('lead', 'contact', 'account'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaign_responses_revenue_minor_nonneg') THEN
    ALTER TABLE bulk.campaign_responses
      ADD CONSTRAINT chk_campaign_responses_revenue_minor_nonneg CHECK (revenue_minor >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaign_responses_version') THEN
    ALTER TABLE bulk.campaign_responses
      ADD CONSTRAINT chk_campaign_responses_version CHECK (version >= 1);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_campaign_responses_tenant_id
  ON bulk.campaign_responses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaign_responses_campaign
  ON bulk.campaign_responses (tenant_id, campaign_id);

-- One row per (campaign, subject): the same lead/contact/account is never
-- double-counted. This is the upsert conflict target — a second response for the
-- same subject UPDATEs responded/converted/revenue instead of inserting.
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_responses_subject
  ON bulk.campaign_responses (tenant_id, campaign_id, subject_type, subject_id);

ALTER TABLE bulk.campaign_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk.campaign_responses FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'bulk'
      AND tablename  = 'campaign_responses'
      AND policyname = 'tenant_isolation_policy'
  ) THEN
    -- Verbatim with the other bulk tables (0007): keyed on the same
    -- SECURITY DEFINER helper that reads the app.tenant_id GUC.
    CREATE POLICY tenant_isolation_policy ON bulk.campaign_responses
      USING (tenant_id = templates.current_tenant_id())
      WITH CHECK (tenant_id = templates.current_tenant_id());
  END IF;
END
$$;

-- Grants — guarded on pg_roles so the file applies cleanly to a database where
-- the service roles have not been provisioned yet (fresh installer run, CI).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON bulk.campaign_responses TO notification_svc;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_scanner') THEN
    GRANT SELECT ON bulk.campaign_responses TO notification_scanner;
  END IF;
END
$$;

COMMENT ON TABLE bulk.campaign_responses IS
  'MK-004: per-subject campaign responses + attributed revenue (paise). One row per (campaign, subject); a re-recorded response upserts. Feeds server-side ROI on GET /notifications/campaigns/:id/metrics.';
COMMENT ON COLUMN bulk.campaigns.budget_minor IS 'MK-001 planned budget in PAISE (bigint minor units, never float).';
COMMENT ON COLUMN bulk.campaigns.actual_cost_minor IS 'MK-004 realised campaign cost in PAISE (bigint minor units). ROI denominator.';
COMMENT ON COLUMN bulk.campaign_responses.revenue_minor IS 'Attributed revenue in PAISE (bigint minor units, integer arithmetic only).';
