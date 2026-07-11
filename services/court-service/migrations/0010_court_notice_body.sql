-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 0010_court_notice_body.sql — §47 notice_template rendered body
--   Adds court.notices.rendered_body (TEXT): the statutory notice text rendered
--   at issuance from the tenant's notice_template config (by notice type), with
--   {{placeholder}} substitution. NULL when no template is configured. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';
ALTER TABLE court.notices ADD COLUMN IF NOT EXISTS rendered_body text;
