-- Migration 0012: fuzzy/alias screening (pg_trgm) + visit-request screening-review flag.
--
-- Feature: a SECOND, non-blocking screening layer alongside the existing exact
-- blind-index (identity_doc_hash) hard-match. Exact matches still HARD-BLOCK at
-- visit-request submission; this adds a normalized-name trigram similarity layer
-- that raises a REVIEW flag (never an auto-deny) so a name/alias variant of a
-- blacklisted/watchlisted person (e.g. "Rajesh Kumar" vs "Rajes Kumar") is
-- surfaced to the guard instead of walking straight through.
--
-- person_name is DPDP-encrypted (AES-256-GCM envelope) and therefore NOT
-- searchable in SQL. `name_normalized` is a lower-cased, punctuation-stripped,
-- whitespace-collapsed rendering of the name maintained by the app on write
-- (blacklist/consumer.ts) purely for fuzzy screening — it holds no more than the
-- name already visible to the same security staff. Rows created before this
-- migration have a NULL name_normalized and are simply skipped by the fuzzy
-- layer (the exact hard-match still applies to them).
--
-- Rollback:
--   ALTER TABLE visitor.visit_requests DROP COLUMN IF EXISTS screening_review_note;
--   ALTER TABLE visitor.visit_requests DROP COLUMN IF EXISTS screening_review;
--   DROP INDEX IF EXISTS visitor.idx_visitor_watchlist_name_trgm;
--   DROP INDEX IF EXISTS visitor.idx_visitor_blacklist_name_trgm;
--   ALTER TABLE visitor.watchlist_entries DROP COLUMN IF EXISTS name_normalized;
--   ALTER TABLE visitor.blacklist_entries DROP COLUMN IF EXISTS name_normalized;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE visitor.blacklist_entries ADD COLUMN IF NOT EXISTS name_normalized text;
ALTER TABLE visitor.watchlist_entries ADD COLUMN IF NOT EXISTS name_normalized text;

-- GIN trigram indexes back the similarity() screen. Tenant scoping is enforced
-- by RLS + an explicit tenant_id predicate in the query; the trgm index handles
-- the fuzzy match itself.
CREATE INDEX IF NOT EXISTS idx_visitor_blacklist_name_trgm
  ON visitor.blacklist_entries USING gin (name_normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_visitor_watchlist_name_trgm
  ON visitor.watchlist_entries USING gin (name_normalized gin_trgm_ops);

-- Visit-request review flag: set true when the fuzzy layer flags a near-miss at
-- submission. Non-blocking — the request is still created; the guard reviews it.
ALTER TABLE visitor.visit_requests
  ADD COLUMN IF NOT EXISTS screening_review boolean NOT NULL DEFAULT false;
ALTER TABLE visitor.visit_requests
  ADD COLUMN IF NOT EXISTS screening_review_note text;
