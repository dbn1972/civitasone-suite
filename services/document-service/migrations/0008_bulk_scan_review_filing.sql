-- Purpose: bulk-scan review / filing / link-orchestration / retention / notification support.
--   * batch_files: persisted PII findings (offsets + masked previews only, never values), degraded pages,
--     stored page-image count, reviewer text overrides (already masked), final masked text key, a bounded
--     masked search snippet (DB search fallback), and a retention-deletion stamp.
--   * batches: notified_completed_at (batch-complete notification sent once per completion cycle).
--   * links: result reason code + PII-free detail from the target service + DB-level maker != checker backstop.
--   * lookup / sweeper indexes.
-- Rollback: ALTER TABLE ... DROP COLUMN / DROP INDEX for every object created here (data in the new columns
--           is derived and re-creatable except review_overrides; destructive - requires explicit approval).
-- Affected services: document-service only (modules/bulk-scan)
-- Additive and idempotent. Safe to re-run. Requires 0005 + 0006. No new table => no new RLS statement needed
-- (the tables touched keep their FORCE RLS tenant_isolation policies from 0005/0006).
SET lock_timeout = '5s';

ALTER TABLE bulk_scan.batch_files ADD COLUMN IF NOT EXISTS pii_findings          jsonb;
ALTER TABLE bulk_scan.batch_files ADD COLUMN IF NOT EXISTS degraded_pages        jsonb;
ALTER TABLE bulk_scan.batch_files ADD COLUMN IF NOT EXISTS page_image_count      integer      NOT NULL DEFAULT 0;
ALTER TABLE bulk_scan.batch_files ADD COLUMN IF NOT EXISTS review_overrides      jsonb;
ALTER TABLE bulk_scan.batch_files ADD COLUMN IF NOT EXISTS final_text_key        varchar(1000);
ALTER TABLE bulk_scan.batch_files ADD COLUMN IF NOT EXISTS search_text           text;
ALTER TABLE bulk_scan.batch_files ADD COLUMN IF NOT EXISTS retention_deleted_at  timestamptz;
-- set when a retention purge asked a target service to drop its link and that unlink is not yet confirmed; the
-- retention sweep re-sends the unlink request until every link of the purged file is unlinked, then clears the flag.
ALTER TABLE bulk_scan.batch_files ADD COLUMN IF NOT EXISTS retention_unlink_pending boolean     NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE bulk_scan.batch_files
    ADD CONSTRAINT bulk_scan_batch_files_search_text_chk CHECK (search_text IS NULL OR char_length(search_text) <= 4000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE bulk_scan.batch_files
    ADD CONSTRAINT bulk_scan_batch_files_page_images_chk CHECK (page_image_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE bulk_scan.batches ADD COLUMN IF NOT EXISTS notified_completed_at timestamptz;

ALTER TABLE bulk_scan.links ADD COLUMN IF NOT EXISTS result_reason varchar(500);   -- shared reason CODE from the target (packages/scan-link LINK_REASON_CODES)
ALTER TABLE bulk_scan.links ADD COLUMN IF NOT EXISTS result_detail jsonb;            -- PII-free scalar context from the target (max 8 keys)
DO $$ BEGIN
  ALTER TABLE bulk_scan.links
    ADD CONSTRAINT bulk_scan_links_maker_checker_chk CHECK (approved_by IS NULL OR approved_by <> requested_by);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- review queue (needs_review, oldest first)
CREATE INDEX IF NOT EXISTS idx_bulk_scan_files_review
  ON bulk_scan.batch_files(tenant_id, updated_at, id) WHERE state = 'needs_review';
-- filed document -> file (download / search / retention); one filed document per file
CREATE UNIQUE INDEX IF NOT EXISTS uq_bulk_scan_files_filed_document
  ON bulk_scan.batch_files(tenant_id, filed_document_id) WHERE filed_document_id IS NOT NULL;
-- retention sweeper + search fallback
CREATE INDEX IF NOT EXISTS idx_bulk_scan_files_filed
  ON bulk_scan.batch_files(tenant_id, doc_type, filed_at) WHERE state = 'filed' AND retention_deleted_at IS NULL;
-- retention of NON-filed terminal files (originals / derivatives / quarantine copies) + unconfirmed unlinks after a purge
CREATE INDEX IF NOT EXISTS idx_bulk_scan_files_nonfiled_retention
  ON bulk_scan.batch_files(tenant_id, updated_at) WHERE state IN ('skipped_duplicate', 'skipped', 'failed', 'cancelled', 'quarantined') AND retention_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bulk_scan_files_unlink_pending
  ON bulk_scan.batch_files(tenant_id, updated_at) WHERE retention_unlink_pending;
-- links by document (download permission)
CREATE INDEX IF NOT EXISTS idx_bulk_scan_links_document ON bulk_scan.links(tenant_id, document_id) WHERE document_id IS NOT NULL;

-- dedicated migration owner (civitas.document_migration_owner): see bulk_scan.apply_migration_owner() in 0005
SELECT bulk_scan.apply_migration_owner();
