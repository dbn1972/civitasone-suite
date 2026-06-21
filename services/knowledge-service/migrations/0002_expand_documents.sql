-- knowledge-service: add missing columns to knowledge.documents to satisfy KnowledgeDocSummarySchema
ALTER TABLE knowledge.documents
  ADD COLUMN IF NOT EXISTS tags         text[]       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS access_level varchar(32)  NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS file_type    varchar(64),
  ADD COLUMN IF NOT EXISTS file_size    bigint,
  ADD COLUMN IF NOT EXISTS author       varchar(200);
