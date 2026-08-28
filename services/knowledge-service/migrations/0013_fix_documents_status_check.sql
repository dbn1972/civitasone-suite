-- Fix knowledge.documents.status check constraint: the live constraint on
-- this database is CHECK (status IN ('draft','published','archived')), but
-- EVERY piece of code that reads or writes documents.status disagrees with
-- it and agrees with each other on a 4-value vocabulary instead:
--   - src/modules/documents/routes.ts's GET /articles/:id mapper allowlists
--     exactly ['draft','under_review','approved','archived'] (falls back to
--     'draft' for anything else, including 'published' -- which the live
--     constraint permits but no application code ever produces or expects).
--   - apps/web/.../knowledge/repository/page.tsx and .../knowledge/list/
--     page.tsx both independently filter/label on 'under_review' and
--     'approved' for documents specifically.
--   - migrations/0005_check_constraints_status_columns.sql already tried to
--     add exactly this constraint, citing "routes.ts status list" as its
--     source of truth, via `ADD CONSTRAINT documents_status_check ...
--     EXCEPTION WHEN duplicate_object THEN NULL` -- silently doing nothing
--     if a constraint with that name already existed. No earlier migration
--     in this repo creates one (0001_init.sql's CREATE TABLE has no check
--     constraint on status at all), so the live 'draft'/'published'/
--     'archived' definition did not come from the current migration
--     history as written -- most likely 0005 was edited after already
--     being applied to this database with different values. Whatever the
--     exact history, the live constraint and the application code have
--     been out of sync since.
--
-- Live-caught by PR #828's regression test: PATCH /v1/knowledge/articles/
-- :id/publish setting status='approved' (matching routes.ts's own GET
-- mapper and the frontend) raised "new row for relation documents violates
-- check constraint documents_status_check" once the fix in that PR made
-- the write actually reach the database for the first time -- the
-- original fake-success bug had been masking this second, independent bug
-- the whole time.
--
-- IMPORTANT: 'published' is kept in the allowed set even though no current
-- application code writes it, because 4 real rows in the demo tenant
-- (00000000-0000-0000-0000-000000000001) already carry status='published'
-- -- almost certainly seed data inserted directly against the live (wrong)
-- constraint rather than through the app. Narrowing the constraint to
-- exclude it would orphan real, pre-existing data as newly-invalid rather
-- than fix anything. The union of every value any code path or existing
-- row actually uses is the safe, non-destructive fix; whether those 4 rows
-- should be migrated to 'approved' for display consistency (routes.ts's
-- GET mapper currently falls back to 'draft' for 'published', so they
-- render as Draft today) is a separate, minor product/data question
-- flagged for the team rather than decided here.
--
-- Unconditional DROP + ADD (not guarded by a swallowed exception) so this
-- actually takes effect regardless of whatever the constraint currently is.
SET lock_timeout = '5s';

ALTER TABLE knowledge.documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE knowledge.documents
  ADD CONSTRAINT documents_status_check
  CHECK (status IN ('draft', 'under_review', 'approved', 'published', 'archived'));
