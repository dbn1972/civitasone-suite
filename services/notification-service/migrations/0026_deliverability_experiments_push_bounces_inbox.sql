-- ============================================================================
-- 0026_deliverability_experiments_push_bounces_inbox.sql
--
-- PURPOSE
--   Creates the persistence layer for six BRD requirements whose application
--   code shipped without a migration (the Drizzle definitions existed, the
--   tables did not, so every route touching them returned 500):
--
--     CR-MKT-04  email deliverability suite — sending domains + DKIM/SPF/DMARC
--                health history                → schema  email
--     CR-MKT-05  engagement analytics — A/B experiments, variants, click
--                heatmap events                → schema  experiments
--     MT-006     web push + in-app messaging   → schema  push
--     INT-12     hard/soft bounce classification + suppression list
--                                              → schema  bounces
--     CR-MKT-06  keyword auto-responses on inbound SMS/WhatsApp
--                                              → schema  notification
--     F.5        human handoff — AI pause/resume protocol on the inbox
--                                              → schema  notification
--
--   Column names/types/defaults mirror the Drizzle definitions exactly:
--     src/modules/email/schema.ts, src/modules/experiments/schema.ts,
--     src/modules/push/schema.ts,  src/modules/bounces/schema.ts,
--     src/modules/inbox/keyword-schema.ts
--   A mismatch here surfaces as a runtime 500, so any change to those files
--   must be paired with a follow-up migration.
--
--   PII columns (bounces.bounce_events.recipient, bounces.suppression_list.
--   recipient, push.push_subscriptions.device_token / endpoint,
--   notification.inbound_auto_responses.sender) are declared `text` because the
--   application stores an AES-256-GCM envelope in them via encryptedText()
--   (DPDP Act 2023). The paired *_hash columns hold a keyed HMAC blind index —
--   irreversible plain text — which is what the UNIQUE constraints and equality
--   lookups run against, since the ciphertext is non-deterministic.
--
-- ROLLBACK
--   Additive only; nothing existing is altered or dropped. To reverse:
--     DROP SCHEMA IF EXISTS bounces CASCADE;
--     DROP SCHEMA IF EXISTS experiments CASCADE;
--     DROP SCHEMA IF EXISTS push CASCADE;
--     DROP SCHEMA IF EXISTS email CASCADE;
--     DROP TABLE IF EXISTS notification.handoff_audit;
--     DROP TABLE IF EXISTS notification.conversation_handoffs;
--     DROP TABLE IF EXISTS notification.inbound_auto_responses;
--     DROP TABLE IF EXISTS notification.keyword_rules;
--   (schema `notification` itself must stay — 0025 owns inbox_correlations.)
--   Requires tech-lead approval per the no-destructive-operations rule.
--
-- AFFECTED SERVICES
--   notification-service   owner; routes, consumers and the domain-auth sweeper
--   helpdesk-service       consumes notification.inbox.handoff.state_changed
--   ai-agent-service       reads aiPaused from the handoff state machine
--   crm-service            consumes notification.inbox.keyword_auto_responded
--   audit-service          consumes audit.event.record emitted by all of the above
--
-- SAFETY
--   Fully additive and idempotent — safe to re-run. Indexes are built
--   CONCURRENTLY, so this file must NOT be wrapped in an explicit transaction
--   (run it with psql -f, which is autocommit per statement).
-- ============================================================================

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS bounces;
CREATE SCHEMA IF NOT EXISTS experiments;
CREATE SCHEMA IF NOT EXISTS push;
CREATE SCHEMA IF NOT EXISTS email;
CREATE SCHEMA IF NOT EXISTS notification;

-- ============================================================================
-- INT-12 — bounces
-- ============================================================================

CREATE TABLE IF NOT EXISTS bounces.bounce_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  delivery_id    uuid,
  recipient      text NOT NULL,
  recipient_hash text NOT NULL,
  channel        varchar(32) NOT NULL DEFAULT 'email',
  smtp_code      varchar(32),
  reason         text,
  classification varchar(16) NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bounces.suppression_list (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  recipient         text NOT NULL,
  recipient_hash    text NOT NULL,
  channel           varchar(32) NOT NULL DEFAULT 'email',
  reason            varchar(40) NOT NULL,
  source            varchar(24) NOT NULL DEFAULT 'bounce',
  soft_bounce_count integer NOT NULL DEFAULT 0,
  suppressed_at     timestamptz NOT NULL DEFAULT now(),
  released_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bounces.suppression_settings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  soft_bounce_threshold integer NOT NULL DEFAULT 5,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1
);

-- ADD CONSTRAINT has no IF NOT EXISTS, so every named constraint is guarded on
-- pg_constraint. Same pattern repeats for each table below.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bounce_events_classification') THEN
    ALTER TABLE bounces.bounce_events
      ADD CONSTRAINT chk_bounce_events_classification
      CHECK (classification IN ('hard', 'soft', 'unknown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bounce_events_channel') THEN
    ALTER TABLE bounces.bounce_events
      ADD CONSTRAINT chk_bounce_events_channel
      CHECK (channel IN ('email', 'sms', 'whatsapp', 'push'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bounce_events_version') THEN
    ALTER TABLE bounces.bounce_events
      ADD CONSTRAINT chk_bounce_events_version CHECK (version >= 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppression_list_reason') THEN
    ALTER TABLE bounces.suppression_list
      ADD CONSTRAINT chk_suppression_list_reason
      CHECK (reason IN ('hard_bounce', 'soft_bounce_threshold', 'complaint', 'manual', 'unsubscribe'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppression_list_source') THEN
    ALTER TABLE bounces.suppression_list
      ADD CONSTRAINT chk_suppression_list_source
      CHECK (source IN ('bounce', 'complaint', 'manual', 'import'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppression_list_soft_count') THEN
    ALTER TABLE bounces.suppression_list
      ADD CONSTRAINT chk_suppression_list_soft_count CHECK (soft_bounce_count >= 0);
  END IF;

  -- Threshold is a positive whole count, never 0: a 0 threshold would suppress
  -- every recipient on their first soft bounce.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppression_settings_threshold') THEN
    ALTER TABLE bounces.suppression_settings
      ADD CONSTRAINT chk_suppression_settings_threshold CHECK (soft_bounce_threshold > 0);
  END IF;
END
$$;

-- countSoftBounces(): WHERE tenant_id = $1 AND recipient_hash = $2 AND classification = 'soft'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounce_events_tenant_hash_class
  ON bounces.bounce_events (tenant_id, recipient_hash, classification);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounce_events_tenant_occurred
  ON bounces.bounce_events (tenant_id, occurred_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounce_events_tenant_delivery
  ON bounces.bounce_events (tenant_id, delivery_id);

-- Arbiter for upsertSuppression()'s ON CONFLICT (tenant_id, recipient_hash).
-- Must be a plain (non-partial) unique index or the upsert cannot use it.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_suppression_list_tenant_hash
  ON bounces.suppression_list (tenant_id, recipient_hash);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_suppression_list_tenant_suppressed
  ON bounces.suppression_list (tenant_id, suppressed_at DESC);
-- isSuppressed()/checkSuppression() only ever look at un-released entries.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_suppression_list_active
  ON bounces.suppression_list (tenant_id, recipient_hash)
  WHERE released_at IS NULL;

-- findThresholdSetting() reads at most one row per tenant.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_suppression_settings_tenant
  ON bounces.suppression_settings (tenant_id);

ALTER TABLE bounces.bounce_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounces.bounce_events        FORCE  ROW LEVEL SECURITY;
ALTER TABLE bounces.suppression_list     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounces.suppression_list     FORCE  ROW LEVEL SECURITY;
ALTER TABLE bounces.suppression_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounces.suppression_settings FORCE  ROW LEVEL SECURITY;

-- ============================================================================
-- CR-MKT-05 — experiments
-- ============================================================================

CREATE TABLE IF NOT EXISTS experiments.experiments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  name              varchar(200) NOT NULL,
  status            varchar(16) NOT NULL DEFAULT 'running',
  winner_variant_id uuid,
  -- Percentage-point margin as an integer, never a float (steering: ratios are
  -- integers, money is bigint minor units).
  winner_margin_pct integer,
  concluded_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS experiments.experiment_variants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  experiment_id  uuid NOT NULL,
  variant_key    varchar(64) NOT NULL,
  allocation_pct integer NOT NULL,
  template_id    uuid,
  sent_count     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS experiments.experiment_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  experiment_id uuid NOT NULL,
  variant_id    uuid NOT NULL,
  delivery_id   uuid,
  event_type    varchar(16) NOT NULL,
  link_position integer,
  link_url      text,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_experiments_status') THEN
    ALTER TABLE experiments.experiments
      ADD CONSTRAINT chk_experiments_status
      CHECK (status IN ('draft', 'running', 'concluded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_experiments_margin') THEN
    ALTER TABLE experiments.experiments
      ADD CONSTRAINT chk_experiments_margin
      CHECK (winner_margin_pct IS NULL OR (winner_margin_pct >= 0 AND winner_margin_pct <= 100));
  END IF;

  -- Whole-percent share, 1..100. validateVariants() enforces the set sums to
  -- exactly 100; per-row bounds are enforced here.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_experiment_variants_allocation') THEN
    ALTER TABLE experiments.experiment_variants
      ADD CONSTRAINT chk_experiment_variants_allocation
      CHECK (allocation_pct >= 1 AND allocation_pct <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_experiment_variants_sent_count') THEN
    ALTER TABLE experiments.experiment_variants
      ADD CONSTRAINT chk_experiment_variants_sent_count CHECK (sent_count >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_experiment_variants_experiment') THEN
    ALTER TABLE experiments.experiment_variants
      ADD CONSTRAINT fk_experiment_variants_experiment
      FOREIGN KEY (experiment_id) REFERENCES experiments.experiments (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_experiment_events_type') THEN
    ALTER TABLE experiments.experiment_events
      ADD CONSTRAINT chk_experiment_events_type
      CHECK (event_type IN ('open', 'click'));
  END IF;
  -- 1-based link index; 0 or negative would silently vanish from the heatmap.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_experiment_events_link_position') THEN
    ALTER TABLE experiments.experiment_events
      ADD CONSTRAINT chk_experiment_events_link_position
      CHECK (link_position IS NULL OR link_position >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_experiment_events_experiment') THEN
    ALTER TABLE experiments.experiment_events
      ADD CONSTRAINT fk_experiment_events_experiment
      FOREIGN KEY (experiment_id) REFERENCES experiments.experiments (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_experiment_events_variant') THEN
    ALTER TABLE experiments.experiment_events
      ADD CONSTRAINT fk_experiment_events_variant
      FOREIGN KEY (variant_id) REFERENCES experiments.experiment_variants (id) ON DELETE CASCADE;
  END IF;
END
$$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_experiments_tenant_created
  ON experiments.experiments (tenant_id, created_at DESC);
-- One variant key per experiment: the key is the business identifier the
-- deterministic allocator sorts on.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_experiment_variants_tenant_exp_key
  ON experiments.experiment_variants (tenant_id, experiment_id, variant_key);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_experiment_variants_tenant_exp
  ON experiments.experiment_variants (tenant_id, experiment_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_experiment_events_tenant_exp
  ON experiments.experiment_events (tenant_id, experiment_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_experiment_events_tenant_variant_type
  ON experiments.experiment_events (tenant_id, variant_id, event_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_experiment_events_fk_variant
  ON experiments.experiment_events (variant_id);

ALTER TABLE experiments.experiments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiments.experiments         FORCE  ROW LEVEL SECURITY;
ALTER TABLE experiments.experiment_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiments.experiment_variants FORCE  ROW LEVEL SECURITY;
ALTER TABLE experiments.experiment_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiments.experiment_events   FORCE  ROW LEVEL SECURITY;

-- ============================================================================
-- MT-006 — push subscriptions + in-app messages
-- ============================================================================

CREATE TABLE IF NOT EXISTS push.push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  user_id      uuid NOT NULL,
  platform     varchar(16) NOT NULL,
  -- Bearer credential for pushing to the device: AES-256-GCM envelope at rest.
  device_token text NOT NULL,
  endpoint     text,
  -- HMAC blind index over the token; the dedup/upsert key.
  token_hash   text NOT NULL,
  user_agent   varchar(400),
  enabled      boolean NOT NULL DEFAULT true,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS push.in_app_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  user_id    uuid NOT NULL,
  title      varchar(200) NOT NULL,
  body       text NOT NULL,
  severity   varchar(24) NOT NULL DEFAULT 'info',
  action_url varchar(2048),
  metadata   jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version    integer NOT NULL DEFAULT 1
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_push_subscriptions_platform') THEN
    ALTER TABLE push.push_subscriptions
      ADD CONSTRAINT chk_push_subscriptions_platform
      CHECK (platform IN ('web', 'android', 'ios'));
  END IF;
  -- A web subscription is undeliverable without its Web Push endpoint, so the
  -- database refuses the row rather than letting a silent no-op subscription in.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_push_subscriptions_web_endpoint') THEN
    ALTER TABLE push.push_subscriptions
      ADD CONSTRAINT chk_push_subscriptions_web_endpoint
      CHECK (platform <> 'web' OR endpoint IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_in_app_messages_severity') THEN
    ALTER TABLE push.in_app_messages
      ADD CONSTRAINT chk_in_app_messages_severity
      CHECK (severity IN ('info', 'warning', 'action_required'));
  END IF;
END
$$;

-- Arbiter for upsertSubscription()'s ON CONFLICT (tenant_id, user_id, token_hash):
-- re-registering the same device must update, not accumulate rows.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_push_subscriptions_tenant_user_token
  ON push.push_subscriptions (tenant_id, user_id, token_hash);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_push_subscriptions_tenant_user_created
  ON push.push_subscriptions (tenant_id, user_id, created_at);
-- findActiveSubscriptions(): the send path's target set.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_push_subscriptions_active
  ON push.push_subscriptions (tenant_id, user_id)
  WHERE enabled AND revoked_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_in_app_messages_tenant_user_created
  ON push.in_app_messages (tenant_id, user_id, created_at DESC);
-- Unread badge count.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_in_app_messages_unread
  ON push.in_app_messages (tenant_id, user_id)
  WHERE read_at IS NULL;

ALTER TABLE push.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push.push_subscriptions FORCE  ROW LEVEL SECURITY;
ALTER TABLE push.in_app_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE push.in_app_messages    FORCE  ROW LEVEL SECURITY;

-- ============================================================================
-- CR-MKT-04 — email deliverability
-- ============================================================================

CREATE TABLE IF NOT EXISTS email.sending_domains (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  domain          varchar(253) NOT NULL,
  dkim_selector   varchar(63) NOT NULL,
  dkim_value      text NOT NULL,
  spf_include     varchar(253) NOT NULL,
  dmarc_policy    varchar(16) NOT NULL DEFAULT 'none',
  health          varchar(16) NOT NULL DEFAULT 'unknown',
  last_checked_at timestamptz,
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS email.domain_auth_checks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  sending_domain_id uuid NOT NULL,
  dkim_status       varchar(16) NOT NULL,
  spf_status        varchar(16) NOT NULL,
  dmarc_status      varchar(16) NOT NULL,
  health            varchar(16) NOT NULL,
  observed          jsonb,
  source            varchar(16) NOT NULL DEFAULT 'scheduled',
  checked_at        timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sending_domains_dmarc_policy') THEN
    ALTER TABLE email.sending_domains
      ADD CONSTRAINT chk_sending_domains_dmarc_policy
      CHECK (dmarc_policy IN ('none', 'quarantine', 'reject'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sending_domains_health') THEN
    ALTER TABLE email.sending_domains
      ADD CONSTRAINT chk_sending_domains_health
      CHECK (health IN ('healthy', 'degraded', 'failing', 'unknown'));
  END IF;
  -- The consumer lowercases the domain before insert; enforce it so a
  -- mixed-case duplicate cannot slip past uq_sending_domains_tenant_domain.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sending_domains_lowercase') THEN
    ALTER TABLE email.sending_domains
      ADD CONSTRAINT chk_sending_domains_lowercase CHECK (domain = lower(domain));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_domain_auth_checks_dkim') THEN
    ALTER TABLE email.domain_auth_checks
      ADD CONSTRAINT chk_domain_auth_checks_dkim
      CHECK (dkim_status IN ('pass', 'fail', 'missing'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_domain_auth_checks_spf') THEN
    ALTER TABLE email.domain_auth_checks
      ADD CONSTRAINT chk_domain_auth_checks_spf
      CHECK (spf_status IN ('pass', 'fail', 'missing'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_domain_auth_checks_dmarc') THEN
    ALTER TABLE email.domain_auth_checks
      ADD CONSTRAINT chk_domain_auth_checks_dmarc
      CHECK (dmarc_status IN ('pass', 'fail', 'missing'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_domain_auth_checks_health') THEN
    ALTER TABLE email.domain_auth_checks
      ADD CONSTRAINT chk_domain_auth_checks_health
      CHECK (health IN ('healthy', 'degraded', 'failing', 'unknown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_domain_auth_checks_source') THEN
    ALTER TABLE email.domain_auth_checks
      ADD CONSTRAINT chk_domain_auth_checks_source
      CHECK (source IN ('scheduled', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_domain_auth_checks_domain') THEN
    ALTER TABLE email.domain_auth_checks
      ADD CONSTRAINT fk_domain_auth_checks_domain
      FOREIGN KEY (sending_domain_id) REFERENCES email.sending_domains (id) ON DELETE CASCADE;
  END IF;
END
$$;

-- One registration per domain per tenant.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_sending_domains_tenant_domain
  ON email.sending_domains (tenant_id, domain);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sending_domains_tenant_created
  ON email.sending_domains (tenant_id, created_at DESC);
-- The domain-auth sweeper scans enabled domains across tenants via the
-- read-only BYPASSRLS scanner role.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sending_domains_enabled
  ON email.sending_domains (id) WHERE enabled;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_domain_auth_checks_tenant_domain_checked
  ON email.domain_auth_checks (tenant_id, sending_domain_id, checked_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_domain_auth_checks_fk_domain
  ON email.domain_auth_checks (sending_domain_id);

ALTER TABLE email.sending_domains    ENABLE ROW LEVEL SECURITY;
ALTER TABLE email.sending_domains    FORCE  ROW LEVEL SECURITY;
ALTER TABLE email.domain_auth_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE email.domain_auth_checks FORCE  ROW LEVEL SECURITY;

-- ============================================================================
-- CR-MKT-06 (keyword auto-responses) + F.5 (human handoff)
-- These live in the existing `notification` schema alongside 0025's
-- inbox_correlations, so the inbox module keeps owning exactly one PG schema
-- (L2 module isolation).
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification.keyword_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  keyword       varchar(120) NOT NULL,
  match_type    varchar(16) NOT NULL DEFAULT 'exact',
  -- NULL = applies to every inbound channel.
  channel       varchar(24),
  -- Lower number = higher precedence.
  priority      integer NOT NULL DEFAULT 100,
  response_body text,
  action        varchar(40),
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS notification.inbound_auto_responses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  rule_id      uuid NOT NULL,
  channel      varchar(24) NOT NULL,
  -- Phone number or email address: AES-256-GCM envelope at rest.
  sender       text NOT NULL,
  sender_hash  text NOT NULL,
  outcome      varchar(24) NOT NULL,
  action       varchar(40),
  responded_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS notification.conversation_handoffs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  conversation_id   uuid NOT NULL,
  state             varchar(24) NOT NULL DEFAULT 'ai_handling',
  assigned_agent_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS notification.handoff_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  conversation_id uuid NOT NULL,
  from_state      varchar(24) NOT NULL,
  to_state        varchar(24) NOT NULL,
  action          varchar(24) NOT NULL,
  agent_id        uuid,
  reason          text,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_keyword_rules_match_type') THEN
    ALTER TABLE notification.keyword_rules
      ADD CONSTRAINT chk_keyword_rules_match_type
      CHECK (match_type IN ('exact', 'prefix', 'contains'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_keyword_rules_channel') THEN
    ALTER TABLE notification.keyword_rules
      ADD CONSTRAINT chk_keyword_rules_channel
      CHECK (channel IS NULL OR channel IN ('sms', 'whatsapp', 'email', 'web_chat', 'social'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_keyword_rules_priority') THEN
    ALTER TABLE notification.keyword_rules
      ADD CONSTRAINT chk_keyword_rules_priority
      CHECK (priority >= 0 AND priority <= 10000);
  END IF;
  -- A rule with neither a reply body nor an action would match and then do
  -- nothing. planAutoResponse() treats that as "no match"; refuse to store it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_keyword_rules_has_effect') THEN
    ALTER TABLE notification.keyword_rules
      ADD CONSTRAINT chk_keyword_rules_has_effect
      CHECK (response_body IS NOT NULL OR action IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_inbound_auto_responses_outcome') THEN
    ALTER TABLE notification.inbound_auto_responses
      ADD CONSTRAINT chk_inbound_auto_responses_outcome
      CHECK (outcome IN ('none', 'reply', 'action', 'reply_and_action'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_inbound_auto_responses_rule') THEN
    ALTER TABLE notification.inbound_auto_responses
      ADD CONSTRAINT fk_inbound_auto_responses_rule
      FOREIGN KEY (rule_id) REFERENCES notification.keyword_rules (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversation_handoffs_state') THEN
    ALTER TABLE notification.conversation_handoffs
      ADD CONSTRAINT chk_conversation_handoffs_state
      CHECK (state IN ('ai_handling', 'paused', 'human_handling', 'closed'));
  END IF;
  -- human_handling without an owner is exactly the ambiguity the state machine
  -- refuses (AGENT_REQUIRED); mirror it in the database.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversation_handoffs_agent') THEN
    ALTER TABLE notification.conversation_handoffs
      ADD CONSTRAINT chk_conversation_handoffs_agent
      CHECK (state <> 'human_handling' OR assigned_agent_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_handoff_audit_from_state') THEN
    ALTER TABLE notification.handoff_audit
      ADD CONSTRAINT chk_handoff_audit_from_state
      CHECK (from_state IN ('ai_handling', 'paused', 'human_handling', 'closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_handoff_audit_to_state') THEN
    ALTER TABLE notification.handoff_audit
      ADD CONSTRAINT chk_handoff_audit_to_state
      CHECK (to_state IN ('ai_handling', 'paused', 'human_handling', 'closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_handoff_audit_action') THEN
    ALTER TABLE notification.handoff_audit
      ADD CONSTRAINT chk_handoff_audit_action
      CHECK (action IN ('pause', 'assign_human', 'resume_ai', 'close'));
  END IF;
END
$$;

-- findEnabledRules(): WHERE tenant_id = $1 AND enabled.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_keyword_rules_tenant_enabled
  ON notification.keyword_rules (tenant_id) WHERE enabled;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_keyword_rules_tenant_priority
  ON notification.keyword_rules (tenant_id, priority, keyword);
-- NOTE: no UNIQUE constraint on (tenant_id, keyword, match_type, channel).
-- The matcher compares normalizeKeyword() output — trimmed, lowercased,
-- whitespace-collapsed and Unicode-punctuation-stripped. SQL cannot reproduce
-- that transformation, so a SQL unique index would enforce a DIFFERENT rule than
-- the one the matcher applies: it would reject rows the app considers distinct
-- while still admitting pairs the app considers identical. compareRules() gives
-- a total, deterministic ordering over duplicates, so ambiguity is impossible
-- at match time and a misleading constraint is worse than none.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inbound_auto_responses_tenant_sender
  ON notification.inbound_auto_responses (tenant_id, sender_hash, responded_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inbound_auto_responses_tenant_rule
  ON notification.inbound_auto_responses (tenant_id, rule_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inbound_auto_responses_fk_rule
  ON notification.inbound_auto_responses (rule_id);

-- Arbiter for upsertHandoff()'s ON CONFLICT (tenant_id, conversation_id): one
-- handoff row per conversation is the whole point of the state machine.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_conversation_handoffs_tenant_conv
  ON notification.conversation_handoffs (tenant_id, conversation_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversation_handoffs_tenant_state
  ON notification.conversation_handoffs (tenant_id, state);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_handoff_audit_tenant_conv_occurred
  ON notification.handoff_audit (tenant_id, conversation_id, occurred_at DESC);

ALTER TABLE notification.keyword_rules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.keyword_rules          FORCE  ROW LEVEL SECURITY;
ALTER TABLE notification.inbound_auto_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.inbound_auto_responses FORCE  ROW LEVEL SECURITY;
ALTER TABLE notification.conversation_handoffs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.conversation_handoffs  FORCE  ROW LEVEL SECURITY;
ALTER TABLE notification.handoff_audit          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.handoff_audit          FORCE  ROW LEVEL SECURITY;

-- ============================================================================
-- Tenant isolation policies
--
-- USING covers SELECT/UPDATE/DELETE, WITH CHECK covers INSERT/UPDATE. Both are
-- required: USING alone would leave INSERT unguarded and let a consumer write a
-- row for another tenant. NULLIF(...,'') means an unset GUC yields NULL, the
-- predicate is never true, and the table fails CLOSED (zero rows) rather than
-- open. current_setting(..., true) is the missing_ok form so an unset GUC does
-- not raise.
-- ============================================================================

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('bounces',      'bounce_events'),
      ('bounces',      'suppression_list'),
      ('bounces',      'suppression_settings'),
      ('experiments',  'experiments'),
      ('experiments',  'experiment_variants'),
      ('experiments',  'experiment_events'),
      ('push',         'push_subscriptions'),
      ('push',         'in_app_messages'),
      ('email',        'sending_domains'),
      ('email',        'domain_auth_checks'),
      ('notification', 'keyword_rules'),
      ('notification', 'inbound_auto_responses'),
      ('notification', 'conversation_handoffs'),
      ('notification', 'handoff_audit')
    ) AS v(schema_name, table_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = t.schema_name
        AND tablename  = t.table_name
        AND policyname = 'tenant_isolation_policy'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation_policy ON %I.%I '
        'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
        'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
        t.schema_name, t.table_name);
    END IF;
  END LOOP;
END
$$;

-- ============================================================================
-- Grants — guarded on pg_roles so this file applies cleanly to a database where
-- the service roles have not been provisioned yet (fresh installer run, CI).
-- No role is created here, and no passwordless LOGIN role exists anywhere in
-- this file: notification_svc and notification_scanner are created by the
-- installer and migration 0024 respectively, both with passwords.
-- ============================================================================

DO $$
DECLARE
  s text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_svc') THEN
    FOREACH s IN ARRAY ARRAY['bounces', 'experiments', 'push', 'email', 'notification'] LOOP
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO notification_svc', s);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO notification_svc', s);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO notification_svc', s);
    END LOOP;
  END IF;
END
$$;

DO $$
DECLARE
  s text;
BEGIN
  -- Read-only. The domain-auth sweeper (the only cross-tenant reader of these
  -- tables) scans email.sending_domains; the remaining schemas are granted for
  -- symmetry with 0024 so a future sweeper does not need another migration.
  -- All WRITES still go through notification_svc under RLS.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_scanner') THEN
    FOREACH s IN ARRAY ARRAY['bounces', 'experiments', 'push', 'email', 'notification'] LOOP
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO notification_scanner', s);
      EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO notification_scanner', s);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO notification_scanner', s);
    END LOOP;
  END IF;
END
$$;
