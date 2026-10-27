-- 0016_documents_unique_title.sql
-- UAT owner decision #15 (GAP-KNOWLEDGE-DOCUMENTS-NEW-05): a tenant cannot hold
-- two live documents with the same title (case-insensitive, trimmed). The create
-- API answers 409 DUPLICATE_TITLE; this index is the race-proof backstop.
-- Archived documents are excluded so a title can be reused after archiving.
--
-- Step 1 renames pre-existing duplicates (keeps the oldest title untouched,
-- suffixes the rest " (2-<id8>)" ..., collision-proof) so the index can be built. documents has
-- FORCE ROW LEVEL SECURITY, so the data fix uses the NO FORCE / FORCE wrap.
ALTER TABLE knowledge.documents NO FORCE ROW LEVEL SECURITY;

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY tenant_id, lower(btrim(title)) ORDER BY created_at, id) AS rn
  FROM knowledge.documents
  WHERE status <> 'archived'
)
UPDATE knowledge.documents d
   SET title = left(d.title, 170) || ' (' || r.rn || '-' || left(d.id::text, 8) || ')'
  FROM ranked r
 WHERE d.id = r.id AND r.rn > 1;

ALTER TABLE knowledge.documents FORCE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS documents_tenant_title_live_uq
  ON knowledge.documents (tenant_id, lower(btrim(title)))
  WHERE status <> 'archived';
