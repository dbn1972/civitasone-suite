-- Migration: 0004c_tenant_branding_unique_tenant.sql
-- Purpose: Enforce one branding.tenant_branding row per tenant.
--
-- branding/repo.ts's upsertBranding command handler was insert-only (see
-- branding/commands.ts, branding/consumer.ts) despite the route being named
-- "upsert" and PUT /v1/themes/branding: every call generated a fresh random
-- id and INSERTed a new row, so repeated saves of a tenant's logo/colors
-- silently accumulated duplicate rows for the same tenant instead of
-- updating one. findByTenant() then did `.limit(1)` with no ORDER BY, so
-- which row a GET returned was whichever order Postgres happened to scan in
-- — not reliably the latest save.
--
-- This table's sibling, theme.brand_config, avoids the whole class of bug by
-- using tenant_id itself as the primary key (see 0001_init.sql), so a
-- concurrent double-insert fails loudly with a duplicate-key error instead of
-- silently succeeding twice. tenant_branding uses a separate `id` PK
-- (schema.ts declares it that way; changing the PK is a bigger migration than
-- this bug warrants), so the same guarantee is added here as a UNIQUE
-- constraint on tenant_id instead: the application fix (branding/commands.ts,
-- branding/repo.ts, branding/consumer.ts — see that PR) now looks up the
-- existing row and updates it in place, and this constraint makes any
-- remaining race (or future regression back to insert-only) fail with a
-- clear constraint violation rather than silently duplicating.
--
-- Safe to apply now: this table was created today (0004b) and is still
-- empty on every environment that has run migrations in order, so there are
-- no pre-existing duplicate rows to reconcile.
-- Rollback: ALTER TABLE branding.tenant_branding DROP CONSTRAINT IF EXISTS uq_tenant_branding_tenant;
--
-- Idempotent: plain `ADD CONSTRAINT` has no `IF NOT EXISTS` form in Postgres
-- (unlike CREATE TABLE/INDEX/SCHEMA elsewhere in this codebase's migrations),
-- and re-running it would raise an error — which scripts/dev/migrate-all.mjs's
-- idempotency check does NOT treat as safe-to-skip (it only skips "already
-- exists" messages that do NOT also contain the literal string "ERROR", and
-- Postgres's real message contains both). Wrapping in a DO block catches
-- that and makes this migration safe to apply more than once, consistent
-- with every other migration in this service.
--
-- Verified empirically against Postgres 16 (this cluster) which class the
-- re-application error actually raises: adding a UNIQUE constraint also
-- creates a supporting unique index of the same name, and re-adding it
-- collides on THAT index — SQLSTATE 42P07 (duplicate_table, Postgres's
-- class for "a relation by this name already exists", covering indexes as
-- well as tables), not 42710 (duplicate_object, the class an initial guess
-- reasonably lands on for "a constraint already exists" but which does NOT
-- fire here). Catching both keeps this migration correct regardless of
-- which the constraint machinery raises.
DO $$ BEGIN
  ALTER TABLE branding.tenant_branding
    ADD CONSTRAINT uq_tenant_branding_tenant UNIQUE (tenant_id);
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
