-- Purpose: Make the `language` assignment rule type (AS-001) functional. The engine
--          already supports matching a lead's language, but crm.contacts had no
--          language column, so leadFacts always passed null and a language rule could
--          never match. This adds a nullable language column; inbound capture now
--          persists it when a channel supplies it, and leadFacts reads it.
-- Rollback: ALTER TABLE crm.contacts DROP COLUMN IF EXISTS language;
-- Affected services: crm-service
-- Sequencing: additive nullable column, no backfill — existing leads simply have a
--             null language and language rules skip them (fall through to fallback),
--             which is the pre-migration behaviour.

SET lock_timeout = '5s';

ALTER TABLE crm.contacts
  ADD COLUMN IF NOT EXISTS language varchar(24);
