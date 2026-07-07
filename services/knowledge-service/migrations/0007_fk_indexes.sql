-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: knowledge-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- knowledge.categories.parent_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_categories_parent_id
  ON knowledge.categories (parent_id);

-- knowledge.retention_policies.category_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_retention_policies_category_id
  ON knowledge.retention_policies (category_id);

-- knowledge.search_index.document_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_search_index_document_id
  ON knowledge.search_index (document_id);

-- knowledge.document_shares.document_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_shares_document_id
  ON knowledge.document_shares (document_id);

-- knowledge.document_versions.document_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_versions_document_id
  ON knowledge.document_versions (document_id);
