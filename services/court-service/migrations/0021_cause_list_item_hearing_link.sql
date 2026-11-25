-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0021_cause_list_item_hearing_link.sql
-- Service:   court-service — DB civitas_court
--
-- Purpose:
--   GAP-COURT-CAUSE-LIST-04 — a cause-list item had no link to a hearing, so the
--   hearing purpose shown for it was DERIVED (case + IST list date) and was
--   ambiguous when a case had several same-day purposes. Add an OPTIONAL exact
--   link: court.cause_list_items.hearing_id -> court.hearings(id).
--
--   Additive + idempotent + NULLABLE (no default, no backfill): every existing
--   row keeps hearing_id NULL and continues to use the derived purpose. A
--   metadata-only ALTER (no table rewrite). ON DELETE SET NULL: a hearing row
--   going away must never cascade-delete a listed item, it only drops the link.
--   The FK is added NOT VALID-free because the column is all-NULL at creation,
--   so validation is instant.
--
-- Row-level security (RLS):
--   cause_list_items already has ENABLE + FORCE RLS + tenant_isolation
--   (0001_court_core.sql). ADD COLUMN leaves those intact. Tenant consistency of
--   the link (hearing in the same tenant/case) is enforced by the command layer.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval; no
--           automatic down-migration):
--   DROP INDEX IF EXISTS court.idx_cause_list_items_hearing;
--   ALTER TABLE court.cause_list_items DROP COLUMN IF EXISTS hearing_id;
--
-- Affected services: court-service only.
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

ALTER TABLE court.cause_list_items
    ADD COLUMN IF NOT EXISTS hearing_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'cause_list_items_hearing_id_fkey'
    ) THEN
        ALTER TABLE court.cause_list_items
            ADD CONSTRAINT cause_list_items_hearing_id_fkey
            FOREIGN KEY (hearing_id) REFERENCES court.hearings(id) ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_cause_list_items_hearing
    ON court.cause_list_items (hearing_id) WHERE hearing_id IS NOT NULL;
