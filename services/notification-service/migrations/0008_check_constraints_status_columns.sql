-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: notification-service

SET lock_timeout = '5s';

-- ============================================================================
-- deliveries.deliveries.status
-- A CHECK constraint (chk_deliveries_status) already exists on this column
-- from migration 0002 covering ('queued', 'sending', 'delivered', 'failed',
-- 'skipped') — confirmed as the real set written by consumer.ts/repo.ts.
-- Do NOT add a second, narrower CHECK here: Postgres ANDs multiple CHECK
-- constraints on the same column, and a conflicting value list would reject
-- valid inserts/updates and break the live delivery pipeline. Nothing to add.
-- ============================================================================

-- ============================================================================
-- bulk.campaigns.status
-- Valid states: draft, scheduled, sending, completed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE bulk.campaigns
    ADD CONSTRAINT campaigns_status_check
    CHECK (status IN ('draft', 'scheduled', 'sending', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- bulk.campaign_recipients.status
-- Valid states: pending (insert default), queued (markRecipientQueued);
-- sent, delivered, failed, skipped kept as the deliveries-status superset
-- repo.ts checks for when aggregating campaign delivered counts.
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE bulk.campaign_recipients
    ADD CONSTRAINT campaign_recipients_status_check
    CHECK (status IN ('pending', 'queued', 'sent', 'delivered', 'failed', 'skipped'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- templates.templates.status
-- Valid states: active, superseded (templates/consumer.ts + repo.ts:
-- create/update → active; supersede → superseded on the prior version)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE templates.templates
    ADD CONSTRAINT templates_status_check
    CHECK (status IN ('active', 'superseded'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE bulk.campaigns VALIDATE CONSTRAINT campaigns_status_check;
ALTER TABLE bulk.campaign_recipients VALIDATE CONSTRAINT campaign_recipients_status_check;
ALTER TABLE templates.templates VALIDATE CONSTRAINT templates_status_check;
