-- Purpose: G18 (spec §25.3, journey J2 step 4) — crm.interaction_outcomes.
--   One row per captured outcome of an interaction on ANY journey subject, not just a
--   lead. §25.3 asks for "reinvested (product, amount), withdrawn (reason code),
--   undecided (follow-up scheduled)"; those are three postal READINGS of three generic
--   outcomes, and the generic form is what is stored:
--
--     converted → the customer took a product. product_id (+ optional amount_minor).
--     declined  → the customer said no. reason_code_id explains why.
--     deferred  → no decision yet. follow_up_next_action_id points at the scheduled
--                 next step (crm.next_actions, AC-002), so "undecided" can never mean
--                 "quietly dropped".
--
--   Every row raises crm.interaction_outcome.recorded, which is what feeds the propensity
--   model and recommendation-service's cross-sell attribution. This table deliberately
--   does NOT duplicate recommendation.cross_sell_attributions: attribution is that
--   service's read model, computed from this event.
--
--   MONEY: amount_minor is bigint MINOR UNITS. Never numeric, never float. It is
--   serialised as a decimal string on the wire because a JSON number silently loses
--   paise above 2^53.
--
--   NO FREE TEXT. There is deliberately no notes column: an outcome is a coded fact, and
--   an agent's prose about a customer is PII this table would then leak into every
--   analytics export (DPDP Act 2023).
--
-- Rollback:
--   SET lock_timeout = '5s';
--   DROP TABLE IF EXISTS crm.interaction_outcomes;   -- drops the FK onto
--                                                    -- crm.outcome_reason_codes too
--   -- No other table references this one, and no downstream service stores its ids:
--   -- the recorded event carries the outcome id but consumers key on their own rows.
-- Affected services: crm-service (outcomes module) publishes;
--   recommendation-service (measurement) and analytics-service consume the event.
-- Sequencing: additive — new table only. Requires 0089 (FK target).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.interaction_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  -- Generic subject reference. Not an FK: the three candidate parents live in three
  -- tables and a polymorphic FK is not expressible; existence is checked at the route
  -- boundary against the tenant's own rows.
  subject_type varchar(24) NOT NULL
    CHECK (subject_type IN ('contact', 'deal', 'next_action')),
  subject_id uuid NOT NULL,
  -- Caller-supplied business key for THIS outcome on THIS subject (call ref, visit ref).
  -- Together with the unique index below it makes a double-submitted capture a no-op
  -- rather than a second outcome that would double-count in the propensity feed.
  outcome_ref varchar(128) NOT NULL,
  outcome_type varchar(24) NOT NULL
    CHECK (outcome_type IN ('converted', 'declined', 'deferred')),
  reason_code_id uuid REFERENCES crm.outcome_reason_codes (id),
  -- Product actually taken. Plain uuid, not an FK to crm.products: a deployment may
  -- keep its catalogue in catalogue-service, and a hard FK would make this table
  -- unusable there.
  product_id uuid,
  amount_minor bigint,
  currency char(3),
  -- The scheduled follow-up that makes a deferral accountable (crm.next_actions).
  follow_up_next_action_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  -- Money is an amount AND a currency, or neither. A bare amount cannot be added up.
  CONSTRAINT ck_interaction_outcomes_money
    CHECK ((amount_minor IS NULL) = (currency IS NULL)),
  CONSTRAINT ck_interaction_outcomes_amount_sign
    CHECK (amount_minor IS NULL OR amount_minor >= 0),
  -- The three governance rules, restated at the table so they hold even if a future
  -- writer skips the domain layer. The domain checks them FIRST so a consumer never
  -- trips a CHECK: a CHECK violation would roll back the inbox row and dead-letter a
  -- command that is a validation failure, not a fault.
  CONSTRAINT ck_interaction_outcomes_converted_product
    CHECK (outcome_type <> 'converted' OR product_id IS NOT NULL),
  CONSTRAINT ck_interaction_outcomes_declined_reason
    CHECK (outcome_type <> 'declined' OR reason_code_id IS NOT NULL),
  CONSTRAINT ck_interaction_outcomes_deferred_follow_up
    CHECK (outcome_type <> 'deferred' OR follow_up_next_action_id IS NOT NULL)
);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_interaction_outcomes_ref
  ON crm.interaction_outcomes (tenant_id, subject_type, subject_id, outcome_ref);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interaction_outcomes_subject
  ON crm.interaction_outcomes (tenant_id, subject_type, subject_id, occurred_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interaction_outcomes_type
  ON crm.interaction_outcomes (tenant_id, outcome_type, occurred_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interaction_outcomes_reason
  ON crm.interaction_outcomes (tenant_id, reason_code_id) WHERE reason_code_id IS NOT NULL;

ALTER TABLE crm.interaction_outcomes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'interaction_outcomes_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'interaction_outcomes'
  ) THEN
    CREATE POLICY interaction_outcomes_tenant_isolation ON crm.interaction_outcomes
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.interaction_outcomes TO crm_svc;
  END IF;
END $g$;
