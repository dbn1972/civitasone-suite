-- Purpose: Create crm.interaction_sentiments — one Voice-of-Customer reading per
--          customer interaction (polarity, score, themes). The CRM could report how
--          many interactions happened but nothing about what customers were saying
--          in them, so there was no way to see a rising complaint theme (P2-6).
-- Rollback: DROP TABLE IF EXISTS crm.interaction_sentiments;
-- Affected services: crm-service
-- Sequencing: additive — a new table with no foreign keys into existing tables, so it
--             is safe to apply before the code that writes it. No backfill: the
--             aggregate reports zero until interactions are scored, and historical
--             activities can be re-scored later by replaying the analyse command.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.interaction_sentiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  -- Opaque id into the activities domain. No cross-module foreign key by design
  -- (CLAUDE.md §3.13) — the reading must stay extractable on its own.
  activity_id uuid NOT NULL,
  activity_type varchar(16) NOT NULL DEFAULT 'note',
  contact_id uuid,
  deal_id uuid,
  polarity varchar(16) NOT NULL
    CHECK (polarity IN ('positive', 'neutral', 'negative')),
  -- Bounded so one very long rant cannot dominate a tenant's average.
  score integer NOT NULL CHECK (score BETWEEN -100 AND 100),
  themes jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Truncated copy of text the operator already stored on the activity, kept so a
  -- reading can be explained without joining back. Introduces no new class of
  -- personal data beyond what crm.activities.text already holds.
  excerpt text,
  -- Which scorer produced this reading, so a model change stays traceable and old
  -- readings are not silently compared against new ones.
  model varchar(32) NOT NULL DEFAULT 'lexicon-v1',
  analysed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

-- One reading per interaction. This is also what makes analysis safe to replay: the
-- consumer inserts ON CONFLICT DO NOTHING against this index, so a redelivered
-- command cannot double-count an interaction in the aggregate.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_interaction_sentiments_activity
  ON crm.interaction_sentiments(tenant_id, activity_id);
-- The summary and the list both scan a tenant's readings newest-first over a window.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interaction_sentiments_tenant_analysed
  ON crm.interaction_sentiments(tenant_id, analysed_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interaction_sentiments_tenant_polarity
  ON crm.interaction_sentiments(tenant_id, polarity);

ALTER TABLE crm.interaction_sentiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.interaction_sentiments FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'interaction_sentiments_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'interaction_sentiments'
  ) THEN
    CREATE POLICY interaction_sentiments_tenant_isolation ON crm.interaction_sentiments
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.interaction_sentiments TO crm_svc;
  END IF;
END $g$;
