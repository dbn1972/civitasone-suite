-- Purpose: GAP-WORKS-TENDERS-DETAIL-01 — structured link from a quotation to
--          the registered contractor (works.contractors). Until now a
--          quotation carried only a free-text contractor_name, so spelling
--          variants of one firm were distinct bidders. Nullable for existing
--          rows; new quotations validate it against works.contractors.
-- Rollback:
--   ALTER TABLE works.quotations DROP COLUMN IF EXISTS contractor_id;
-- Affected services: works-service

SET lock_timeout = '5s';

ALTER TABLE works.quotations
  ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES works.contractors(id);
