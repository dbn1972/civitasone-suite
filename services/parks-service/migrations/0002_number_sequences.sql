-- Purpose: Close a duplicate-reference-number bug found during hardening
-- review of complaints/commands.ts, tree_requests/commands.ts and
-- assets/commands.ts: all three generate their human-facing
-- complaint_number / request_number / asset_code as a bare
-- `PRK{,T,A}-${Date.now()}` template literal, computed once in the HTTP
-- route's command handler (before the command is even published to the
-- queue). Date.now() is millisecond-resolution wall-clock time -- any two
-- create requests processed in the same millisecond (a real occurrence
-- under concurrent load, e.g. two officers submitting at once, or a retried
-- request) reserve the identical number, and none of the three columns
-- carried a UNIQUE constraint, so nothing at the DB layer would even reject
-- the second one -- it would silently duplicate.
--
-- Fix (this migration is half of it -- see the paired application-code
-- change in complaints/repo.ts's nextComplaintNumber, tree_requests/repo.ts's
-- nextRequestNumber and assets/repo.ts's nextAssetCode, each called via
-- nextval() from inside the same consumer transaction that inserts the
-- row): one Postgres SEQUENCE per number type, replacing Date.now(). Same
-- fix shape as inspection-service's identical bug (see
-- services/inspection-service/migrations/
-- 0028_encroachment_illegal_construction_number_sequences.sql) and
-- tonight's animal-service fix (services/animal-service/migrations/
-- 0002_number_sequences.sql).
--
-- Ownership: parks_svc is the OWNER of civitas_parks (see
-- infra/db/bootstrap/bootstrap_municipal_services.sql: "CREATE DATABASE
-- civitas_parks OWNER parks_svc") and of the civitas_parks schema it
-- created in 0001_initial.sql. A sequence created here therefore needs no
-- separate GRANT: it is owned by parks_svc exactly like every table in this
-- schema already is (matches animal-service's reasoning, which has the
-- same ownership model -- unlike inspection-service's admin-owned tables).
--
-- Uniqueness scope: UNIQUE (tenant_id, <number>) rather than a bare global
-- UNIQUE (<number>). The sequences below are still GLOBAL (not per-tenant --
-- matches the Date.now() calls they replace, which took no tenant argument
-- at all, so a global sequence preserves that exact scoping and already
-- guarantees global, not just per-tenant, uniqueness). The tenant-scoped
-- constraint is the defense actually asked for: it fails a write outright
-- if two rows for the same tenant ever end up with the same number, without
-- depending on every future number-generation path continuing to route
-- through the shared global sequence.
--
-- Seeding: setval() to one past the highest existing trailing number per
-- table, so a table that already has rows can't hand out a number that
-- collides with one already in use. GREATEST(1, ...) keeps the seed >= 1
-- (default sequences have MINVALUE 1); an empty table (MAX IS NULL) seeds
-- at 1, identical to a fresh `START 1` sequence's first nextval().
--
-- Rollback:
--   ALTER TABLE civitas_parks.parks_complaints DROP CONSTRAINT IF EXISTS parks_complaints_tenant_number_key;
--   ALTER TABLE civitas_parks.parks_tree_requests DROP CONSTRAINT IF EXISTS parks_tree_requests_tenant_number_key;
--   ALTER TABLE civitas_parks.parks_assets DROP CONSTRAINT IF EXISTS parks_assets_tenant_code_key;
--   DROP SEQUENCE IF EXISTS civitas_parks.complaint_number_seq;
--   DROP SEQUENCE IF EXISTS civitas_parks.request_number_seq;
--   DROP SEQUENCE IF EXISTS civitas_parks.asset_code_seq;
-- Affected services: parks-service

SET lock_timeout = '5s';

-- 1. Tenant-scoped UNIQUE constraints (idempotent add pattern used elsewhere
--    in this repo, e.g. contract-service/migrations/0013_templates_schema.sql).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'parks_complaints_tenant_number_key'
                    AND conrelid = 'civitas_parks.parks_complaints'::regclass) THEN
    ALTER TABLE civitas_parks.parks_complaints
      ADD CONSTRAINT parks_complaints_tenant_number_key UNIQUE (tenant_id, complaint_number);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'parks_tree_requests_tenant_number_key'
                    AND conrelid = 'civitas_parks.parks_tree_requests'::regclass) THEN
    ALTER TABLE civitas_parks.parks_tree_requests
      ADD CONSTRAINT parks_tree_requests_tenant_number_key UNIQUE (tenant_id, request_number);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'parks_assets_tenant_code_key'
                    AND conrelid = 'civitas_parks.parks_assets'::regclass) THEN
    ALTER TABLE civitas_parks.parks_assets
      ADD CONSTRAINT parks_assets_tenant_code_key UNIQUE (tenant_id, asset_code);
  END IF;
END $$;

-- 2. Sequences replacing Date.now(), seeded past the highest existing
--    trailing numeric suffix so an already-populated table can't collide.
CREATE SEQUENCE IF NOT EXISTS civitas_parks.complaint_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS civitas_parks.request_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS civitas_parks.asset_code_seq START 1;

SELECT setval('civitas_parks.complaint_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(complaint_number, '(\d+)$'))[1]::bigint)
              FROM civitas_parks.parks_complaints), 0) + 1), false);
SELECT setval('civitas_parks.request_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(request_number, '(\d+)$'))[1]::bigint)
              FROM civitas_parks.parks_tree_requests), 0) + 1), false);
SELECT setval('civitas_parks.asset_code_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(asset_code, '(\d+)$'))[1]::bigint)
              FROM civitas_parks.parks_assets), 0) + 1), false);
