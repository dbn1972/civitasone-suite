-- Migration 0042: tender indent link + single-source justification capture.
--
-- GAP-PROCUREMENT-TENDERS-NEW-01: a tender could be created with no link to the
-- indent that authorised it, breaking the indent -> tender -> PO chain. Add an
-- opaque indent_ref ("procurement_indent:<uuid>") on the tender, mirroring the
-- same cross-domain-reference convention po.procurement_pos.indent_ref already
-- uses (CLAUDE.md rule 13: reference other domains by opaque id, never an FK).
--
-- GAP-PROCUREMENT-TENDERS-NEW-02: GFR Rule 166 requires a RECORDED justification
-- for a single-source / proprietary tender (and an approving authority). Capture
-- justification_category, justification (free text) and approving_authority so a
-- single_source tender carries its audit-sensitive reason. All nullable/additive
-- (an open/limited/gem tender needs none); the application layer enforces that a
-- single_source tender supplies them.
--
-- Additive + idempotent. Safe to re-run. New columns on an already-granted,
-- already-RLS'd table (tender.procurement_tenders), so no new GRANT/policy.
-- Rollback:
--   ALTER TABLE tender.procurement_tenders
--     DROP COLUMN IF EXISTS indent_ref,
--     DROP COLUMN IF EXISTS justification_category,
--     DROP COLUMN IF EXISTS justification,
--     DROP COLUMN IF EXISTS approving_authority;
-- Affected services: procurement-service (tender module)

BEGIN;

SET lock_timeout = '5s';

ALTER TABLE tender.procurement_tenders
  ADD COLUMN IF NOT EXISTS indent_ref            TEXT,
  ADD COLUMN IF NOT EXISTS justification_category VARCHAR(32),
  ADD COLUMN IF NOT EXISTS justification         TEXT,
  ADD COLUMN IF NOT EXISTS approving_authority   TEXT;

COMMIT;
