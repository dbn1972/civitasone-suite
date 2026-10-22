-- Purpose: GAP-CRM-PRICE-BOOKS-01 -- append-only CHANGE HISTORY of a price book.
--   A price book drives the unit price every later quotation resolves, and it is edited
--   in place (crm.price_books.version / updated_by / updated_at record only the LAST
--   change). This table keeps one row per version bump: who changed it, when, the
--   reason the maker gave for editing a live book, and a compact before/after summary
--   (which book fields changed; which product prices were added / changed / removed, in
--   bigint MINOR units carried as strings). It is the audit-event read path the editor's
--   history drawer was waiting for -- the audit-service events are write-only from here.
--   Existing quotations are unaffected: they snapshot their own unit_price_minor.
-- Rollback: DROP TABLE IF EXISTS crm.price_book_history;
-- Affected services: crm-service (price-books module)
-- Sequencing: additive -- one new tenant-scoped, append-only table (crm_svc gets
--             SELECT + INSERT only). No backfill: books edited before this migration have
--             no history rows and the drawer says so. price_book_id carries no FK so the
--             history of a deleted book is retained for audit.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.price_book_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  price_book_id uuid NOT NULL,
  -- The price_books.version this change produced (1 for the create).
  version       integer NOT NULL,
  action        varchar(16) NOT NULL CHECK (action IN ('create', 'update', 'item')),
  changed_by    uuid NOT NULL,
  changed_at    timestamptz NOT NULL DEFAULT now(),
  -- Why a live book was edited (required by the editor for an enabled book).
  reason        varchar(500),
  -- { fields: [{field, from, to}], prices: [{productId, fromMinor, toMinor}], entryCount }
  changes       jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_price_book_history_book
  ON crm.price_book_history (tenant_id, price_book_id, changed_at DESC);

ALTER TABLE crm.price_book_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.price_book_history FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'price_book_history_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'price_book_history'
  ) THEN
    CREATE POLICY price_book_history_tenant_isolation ON crm.price_book_history
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    -- Append-only: history is never rewritten or deleted by the service.
    GRANT SELECT, INSERT ON crm.price_book_history TO crm_svc;
  END IF;
END $g$;
