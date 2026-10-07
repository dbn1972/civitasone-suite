-- 0048_library_book_status.sql
-- GAP-ESTAB-LIBRARY-DETAIL-01: add a status column to library books so we
-- can distinguish "withdrawn" from "out of stock" (both have copies=0).
-- Rollback: ALTER TABLE facilities.estab_library_books DROP COLUMN IF EXISTS status;

SET lock_timeout = '5s';

ALTER TABLE facilities.estab_library_books
  ADD COLUMN IF NOT EXISTS status varchar(24) NOT NULL DEFAULT 'active';

-- Check constraint: only known status values
ALTER TABLE facilities.estab_library_books
  DROP CONSTRAINT IF EXISTS chk_library_book_status;
ALTER TABLE facilities.estab_library_books
  ADD CONSTRAINT chk_library_book_status CHECK (status IN ('active', 'withdrawn'));
