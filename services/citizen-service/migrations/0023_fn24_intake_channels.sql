-- FN-24 — expand intake channel vocabulary to match catalogue SERVICE_CHANNELS
-- (portal, counter, mobile, assisted, whatsapp, api). Additive / idempotent.
SET lock_timeout = '5s';

ALTER TABLE application.application_drafts
  DROP CONSTRAINT IF EXISTS application_drafts_channel_check;

ALTER TABLE application.application_drafts
  ADD CONSTRAINT application_drafts_channel_check
  CHECK (channel IN ('portal', 'counter', 'mobile', 'assisted', 'whatsapp', 'api'));
