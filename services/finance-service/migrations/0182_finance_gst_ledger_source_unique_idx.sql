-- 0182_finance_gst_ledger_source_unique_idx.sql  -- NON-TRANSACTIONAL: CREATE INDEX CONCURRENTLY cannot run in a transaction.
-- Keep this file free of BEGIN/COMMIT and of any other statement. MSME M3a (design section 4): one ledger row per tax line of a source
-- document. The key makes producer re-delivery idempotent (the consumer INSERTs ON CONFLICT DO NOTHING against exactly this index).
-- PARTIAL: legacy / manual rows without a source document (source_doc_id IS NULL) are unconstrained, exactly as before.
-- The table is empty, so the build is instant; CONCURRENTLY anyway so the migration is safe to re-run on a table that has filled.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_gst_ledger_source_line
  ON gl.finance_gst_ledger (tenant_id, source_doc_type, source_doc_id, gst_type, direction, rate_pct)
  WHERE source_doc_id IS NOT NULL;
