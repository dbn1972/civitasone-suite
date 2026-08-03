-- Purpose: R1 outbound consent gate — record per-channel consent for the two
--          commercial channels (SMS, WhatsApp) that carry a statutory opt-in
--          requirement (TRAI/DLT, DPDP purpose limitation). Without these
--          columns the send gate has nothing to check for sms/whatsapp and
--          cannot fail closed.
--          Also adds the lookup indexes the gate needs on its hot path
--          (prefs by user+event, DND windows by user).
-- Rollback: ALTER TABLE templates.prefs DROP COLUMN IF EXISTS sms, DROP COLUMN IF EXISTS whatsapp;
--           DROP INDEX IF EXISTS templates.idx_prefs_tenant_user_event;
--           DROP INDEX IF EXISTS dnd.idx_dnd_windows_tenant_user;
-- Affected services: notification-service (templates prefs module, deliveries consent gate, bulk fan-out)
--
-- Safety: additive + idempotent. Both columns are NOT NULL DEFAULT false, so
-- existing rows backfill without a table rewrite lock on PG 16 (constant
-- default is stored in the catalogue). Default `false` is the fail-closed
-- value: an existing recipient has NOT opted in to SMS/WhatsApp, and the gate
-- treats absence of an explicit opt-in on those channels as "no consent".
SET lock_timeout = '5s';

ALTER TABLE templates.prefs
  ADD COLUMN IF NOT EXISTS sms      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp boolean NOT NULL DEFAULT false;

-- The gate reads prefs by (tenant, user) and matches the event type in memory.
CREATE INDEX IF NOT EXISTS idx_prefs_tenant_user_event
  ON templates.prefs (tenant_id, user_id, event_type);

-- The gate reads enabled DND windows by (tenant, user) on every send.
CREATE INDEX IF NOT EXISTS idx_dnd_windows_tenant_user
  ON dnd.dnd_windows (tenant_id, user_id) WHERE enabled;
