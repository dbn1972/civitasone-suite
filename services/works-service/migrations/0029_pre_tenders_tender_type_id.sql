-- Purpose: owner decision D4c #40 (GAP-WORKS-TENDERS-NEW-03) — save a pre-tender's type by its master record.
--          Nullable, so existing rows (which only carry the text tender_type code) stay valid; the text column is kept.
-- Rollback: ALTER TABLE works.pre_tenders DROP COLUMN IF EXISTS tender_type_id;
-- Affected services: works-service

SET lock_timeout = '5s';

ALTER TABLE works.pre_tenders ADD COLUMN IF NOT EXISTS tender_type_id uuid;
