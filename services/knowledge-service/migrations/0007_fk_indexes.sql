-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: knowledge-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
--
-- AMENDED 2026-07-27 — idempotency repair, no behaviour change.
--
-- All five tables indexed below were declared in Drizzle models but never created
-- by any migration; 0011_missing_module_tables.sql creates them. This file
-- therefore aborted at its first statement on every database, and with
-- ON_ERROR_STOP=1 none of the five indexes were ever created anywhere. The header
-- claim of idempotency was false.
--
-- The guards use psql \if rather than a DO block because CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction, and a PL/pgSQL block is one.
-- Each statement is skipped when its table is absent instead of aborting the file.
--
-- 0011 also creates all five indexes under these exact names, so a fresh database
-- ends up correctly indexed regardless of the order the two files run in; on an
-- existing database this file now creates the ones that are genuinely missing.

SET lock_timeout = '5s';

-- knowledge.categories.parent_id (FK-style lookup column, no covering index found)
SELECT to_regclass('knowledge.categories') IS NOT NULL AS has_categories \gset
\if :has_categories
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_categories_parent_id
  ON knowledge.categories (parent_id);
\endif

-- knowledge.retention_policies.category_id (FK-style lookup column, no covering index found)
SELECT to_regclass('knowledge.retention_policies') IS NOT NULL AS has_retention \gset
\if :has_retention
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_retention_policies_category_id
  ON knowledge.retention_policies (category_id);
\endif

-- knowledge.search_index.document_id (FK-style lookup column, no covering index found)
SELECT to_regclass('knowledge.search_index') IS NOT NULL AS has_search \gset
\if :has_search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_search_index_document_id
  ON knowledge.search_index (document_id);
\endif

-- knowledge.document_shares.document_id (FK-style lookup column, no covering index found)
SELECT to_regclass('knowledge.document_shares') IS NOT NULL AS has_shares \gset
\if :has_shares
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_shares_document_id
  ON knowledge.document_shares (document_id);
\endif

-- knowledge.document_versions.document_id (FK-style lookup column, no covering index found)
SELECT to_regclass('knowledge.document_versions') IS NOT NULL AS has_versions \gset
\if :has_versions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_versions_document_id
  ON knowledge.document_versions (document_id);
\endif
