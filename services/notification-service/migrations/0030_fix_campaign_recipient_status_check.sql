-- ============================================================================
-- 0030_fix_campaign_recipient_status_check.sql
--
-- PURPOSE
--   Repairs a latent defect that makes a campaign send impossible to persist.
--   Not a new feature — a correctness fix, same class as 0027.
--
--   Migration 0008 declares the admissible set for
--   bulk.campaign_recipients.status as:
--     ('pending','queued','sent','delivered','failed','skipped')
--   but it adds the constraint inside a
--     DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--   guard. On any database that already carried a constraint of that name, the
--   ADD raised duplicate_object and was silently swallowed, so the older,
--   narrower definition survived. Observed on the dev cluster:
--     campaign_recipients_status_check
--       CHECK (status IN ('pending','sent','failed','skipped'))
--   — 'queued' is missing.
--
--   Consequence: bulk/consumer.ts fans a campaign out by calling
--   repo.markRecipientQueued(), which writes status='queued'. That write is
--   rejected, the whole sendCampaign transaction rolls back, and the campaign
--   is dead-lettered with every recipient still at 'pending'. Reproduced by
--   tests/consent-gate-consumer.test.ts before this migration:
--     new row for relation "campaign_recipients" violates check constraint
--     "campaign_recipients_status_check"
--
--   This migration replaces the constraint unconditionally (drop by name, then
--   re-add) with the set the code actually writes, so a drifted database
--   converges on the intended definition instead of silently keeping the old
--   one.
--
-- WHY THIS IS SAFE
--   * A CHECK constraint is dropped and immediately re-added — no table, no
--     column, no data is touched.
--   * The new set is a strict SUPERSET of every definition seen in the wild, so
--     no existing row can be invalidated. VALIDATE therefore cannot fail.
--   * The column stays constrained: it is never left without a CHECK.
--   * Idempotent — re-running produces the same constraint.
--
-- Rollback: ALTER TABLE bulk.campaign_recipients
--             DROP CONSTRAINT IF EXISTS campaign_recipients_status_check;
--           ALTER TABLE bulk.campaign_recipients
--             ADD CONSTRAINT campaign_recipients_status_check
--             CHECK (status IN ('pending','sent','failed','skipped'));
--           (Only safe once no row holds 'queued' or 'delivered'.)
-- Affected services: notification-service (bulk campaign module)
-- ============================================================================
SET lock_timeout = '5s';

ALTER TABLE bulk.campaign_recipients
  DROP CONSTRAINT IF EXISTS campaign_recipients_status_check;

ALTER TABLE bulk.campaign_recipients
  ADD CONSTRAINT campaign_recipients_status_check
  CHECK (status IN ('pending', 'queued', 'sent', 'delivered', 'failed', 'skipped'))
  NOT VALID;

ALTER TABLE bulk.campaign_recipients
  VALIDATE CONSTRAINT campaign_recipients_status_check;
