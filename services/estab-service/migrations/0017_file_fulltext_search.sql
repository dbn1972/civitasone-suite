-- estab-service: full-text search over files (CSMOP "searchable file title" +
-- note-sheet content). Additive, idempotent. Uses Postgres FTS (no external
-- search infra required); a generated tsvector keeps the index current.

ALTER TABLE files.estab_files
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(subject, '') || ' ' || coalesce(file_no, '') || ' ' || coalesce(dept, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_estab_files_fts
  ON files.estab_files USING gin (search_tsv);

-- Note-sheet content search (find a file by what was written in its notings).
CREATE INDEX IF NOT EXISTS idx_estab_notings_fts
  ON files.estab_notings USING gin (to_tsvector('english', coalesce(body, '')));
