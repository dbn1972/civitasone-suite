-- Purpose: DM-002 fix — crm.document_types.applies_to was a SCALAR varchar(16) (one
--   subject type per document type), but the frontend (DocumentTypesEditor.tsx) has
--   always modeled + tested this as a multi-select (appliesTo: SubjectType[], checkbox
--   UI, an EMPTY array meaning "applies to every subject type" - see
--   apps/web/src/lib/crm/documents.ts's computeAlerts and its own documentsHttp.test.ts
--   fixtures, which already use multi-value arrays). Every create/update from that UI
--   sent an array and failed the old z.enum()-backed scalar validator unconditionally,
--   even for a single checked box. A real document type (e.g. a PAN card or company
--   registration certificate) legitimately applies to more than one subject type, and
--   the "applies to everything" wildcard is meaningfully different from "applies to
--   exactly one of six" - a scalar column cannot express either. Widened to a real
--   array rather than narrowing the frontend to single-select, which would have thrown
--   away that already-built, already-tested behavior for no gain (see PR description).
-- Rollback: ALTER TABLE crm.document_types DROP CONSTRAINT IF EXISTS chk_document_types_applies_to;
--           ALTER TABLE crm.document_types ALTER COLUMN applies_to TYPE varchar(16)
--             USING (CASE WHEN cardinality(applies_to) > 0 THEN applies_to[1] ELSE 'lead' END);
--           ALTER TABLE crm.document_types ADD CONSTRAINT document_types_applies_to_check
--             CHECK (applies_to IN ('lead','contact','account','opportunity','quotation','case'));
--           DROP INDEX CONCURRENTLY IF EXISTS idx_document_types_applies;
--           CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_types_applies
--             ON crm.document_types(tenant_id, applies_to) WHERE enabled = true AND mandatory = true;
--           NOTE: the rollback's TYPE...USING collapses any row that legitimately applies
--           to 2+ subject types down to just its first one (and an empty/wildcard row
--           down to 'lead') - only safe before such rows exist; after, it's lossy.
-- Affected services: crm-service (documents module)
-- Sequencing: every existing row already holds exactly one value, so wrapping it in a
--   single-element array (USING ARRAY[applies_to]) is lossless - no real backfill needed.

SET lock_timeout = '5s';

-- The old scalar CHECK's name (see 0068) was the table's auto-generated default,
-- document_types_applies_to_check - drop it before changing the column's type.
ALTER TABLE crm.document_types DROP CONSTRAINT IF EXISTS document_types_applies_to_check;

DROP INDEX CONCURRENTLY IF EXISTS crm.idx_document_types_applies;

ALTER TABLE crm.document_types
  ALTER COLUMN applies_to TYPE varchar(16)[] USING ARRAY[applies_to];

-- Every element must still be one of the six known subject types; the array itself may
-- be empty (the wildcard "applies to everything" convention above).
ALTER TABLE crm.document_types
  ADD CONSTRAINT chk_document_types_applies_to
  CHECK (applies_to <@ ARRAY['lead','contact','account','opportunity','quotation','case']::varchar[]);

-- A btree index on a scalar column doesn't serve an array; GIN supports the
-- containment lookup ("which mandatory types apply to subject X") this was for.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_types_applies
  ON crm.document_types USING GIN (applies_to) WHERE enabled = true AND mandatory = true;
