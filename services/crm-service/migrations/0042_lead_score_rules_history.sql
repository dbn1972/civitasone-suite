-- Purpose: LQ-002 — make lead scoring per-tenant configurable and keep a score
--          history. crm.lead_score_rules holds the tenant's weighted attribute
--          rules (falls back to code defaults when none configured, lazy-seeded);
--          crm.lead_score_history records every (re)score for trend/audit.
-- Rollback: DROP TABLE IF EXISTS crm.lead_score_history;
--           DROP TABLE IF EXISTS crm.lead_score_rules;
-- Affected services: crm-service
-- Sequencing: additive — two new tenant-scoped tables, no FK into existing tables.
--             Rules are seeded lazily per tenant on first read (ON CONFLICT DO
--             NOTHING), so no backfill.

SET lock_timeout = '5s';

-- ── Configurable scoring rules ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm.lead_score_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  -- The lead attribute this rule evaluates (leadSource, company, lastActivityAt, ...).
  attribute     varchar(64) NOT NULL,
  weight        integer NOT NULL DEFAULT 0 CHECK (weight BETWEEN 0 AND 100),
  -- How the attribute value maps to a 0-100 partial score. Interpreted by
  -- score-rules-domain.buildScoreFn: presence | map | recency | numeric_threshold.
  score_fn_type varchar(24) NOT NULL DEFAULT 'presence'
    CHECK (score_fn_type IN ('presence', 'map', 'recency', 'numeric_threshold')),
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1
);

-- One rule per (tenant, attribute): PUT upserts by attribute and lazy seeding
-- inserts ON CONFLICT DO NOTHING against this index, so a race cannot double-seed.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_lead_score_rules_tenant_attr
  ON crm.lead_score_rules (tenant_id, attribute);

ALTER TABLE crm.lead_score_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_score_rules FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='crm'
      AND tablename='lead_score_rules' AND policyname='lead_score_rules_tenant_isolation') THEN
    CREATE POLICY lead_score_rules_tenant_isolation ON crm.lead_score_rules
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- ── Score history ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm.lead_score_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  lead_id        uuid NOT NULL,
  score          integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  previous_score integer,
  -- Per-factor breakdown ({ attribute: partialScore } for rule scoring, or the ML
  -- explainability factors) so a score change is explainable after the fact.
  factors        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- rule | ml — which scoring path produced this score.
  source         varchar(8) NOT NULL DEFAULT 'rule' CHECK (source IN ('rule', 'ml')),
  reason         text,
  scored_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_score_history_lead
  ON crm.lead_score_history (tenant_id, lead_id, scored_at DESC);

ALTER TABLE crm.lead_score_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_score_history FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='crm'
      AND tablename='lead_score_history' AND policyname='lead_score_history_tenant_isolation') THEN
    CREATE POLICY lead_score_history_tenant_isolation ON crm.lead_score_history
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.lead_score_rules TO crm_svc;
    GRANT SELECT, INSERT ON crm.lead_score_history TO crm_svc;
  END IF;
END $g$;
