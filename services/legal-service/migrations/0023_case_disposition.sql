-- Migration: 0023_case_disposition
-- Purpose: Add cases.legal_cases.disposition (TEXT, nullable) so the
--   disposition text collected by PATCH /v1/legal/cases/:id/dispose is
--   actually persisted. Found during deep-verification: disposeCaseBody
--   (validators.ts) requires and zod-validates a 1-500 char `disposition`
--   string, and it reaches the consumer (cases/consumer.ts, caseDispose
--   handler), but repo.updateCase() was only ever called with
--   { status: "disposed", updatedBy, version } -- the disposition value
--   was discarded the instant the queued command was processed, with no
--   record of it anywhere (not in this table, not in the audit event
--   payload either). A user disposing a writ petition with "Writ allowed,
--   quashing impugned order" would have that text silently vanish.
-- Rollback: ALTER TABLE cases.legal_cases DROP COLUMN IF EXISTS disposition;
-- Affected services: legal-service

SET lock_timeout = '5s';

ALTER TABLE cases.legal_cases
  ADD COLUMN IF NOT EXISTS disposition TEXT;
