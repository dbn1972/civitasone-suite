-- Purpose: CR-CDP-02 — phonetic / approximate name matching support. One row per profile
--          holding the diacritic-folded normalized name and the sorted set of Soundex
--          codes of its tokens (computed by src/modules/identity/phonetic-domain.ts).
--          Postgres is used only to RETRIEVE a bounded candidate window; the match score
--          is computed in the pure domain so it is reproducible in a unit test and
--          auditable after the fact.
--
--          Extension use: pg_trgm is REQUIRED — the GIN index below backs the `%`
--          similarity probe that catches typos the phonetic coder misses. Availability was
--          confirmed with
--            SELECT * FROM pg_available_extensions WHERE name IN ('fuzzystrmatch','pg_trgm');
--          (both available, pg_trgm 1.6, fuzzystrmatch 1.2). fuzzystrmatch is deliberately
--          NOT created: its soundex()/levenshtein() would give a second, subtly different
--          implementation of scoring that already exists in TypeScript, and a name that
--          matched in SQL but not in the domain would be the hardest class of identity bug
--          to diagnose.
-- Rollback: DROP TABLE IF EXISTS cdp.profile_name_keys;   (destructive — requires approval)
--           DROP EXTENSION IF EXISTS pg_trgm;             (only if nothing else uses it)
--           Rolling back disables approximate name search; no customer data is lost
--           because the source of truth is cdp.profiles.attributes.
-- Affected services: cdp-service (owner). No cross-service reads.
SET lock_timeout = '5s';

-- Idempotent and safe to re-run. Requires a superuser or a role with CREATE on the
-- database, which is how every other cdp migration is applied.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS cdp.profile_name_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  profile_id      uuid NOT NULL REFERENCES cdp.profiles(id) ON DELETE CASCADE,
  name_normalized varchar(200) NOT NULL,
  phonetic_key    varchar(200) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         int NOT NULL DEFAULT 1
);

-- One key per profile. Also the arbiter for the ON CONFLICT upsert in name-key-repo.ts:
-- a renamed profile must refresh its key rather than accumulate stale ones that would
-- keep matching forever.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_profile_name_keys_profile
  ON cdp.profile_name_keys (tenant_id, profile_id);

-- Probe 1: exact phonetic agreement (transliteration variants).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profile_name_keys_phonetic
  ON cdp.profile_name_keys (tenant_id, phonetic_key);

-- Probe 2: trigram similarity (typos, dropped/added letters). Without this index the `%`
-- operator degrades to a sequential scan, which is exactly the unbounded cost the
-- candidate window exists to avoid.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profile_name_keys_trgm
  ON cdp.profile_name_keys USING gin (name_normalized gin_trgm_ops);

ALTER TABLE cdp.profile_name_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdp.profile_name_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_name_keys_tenant_isolation ON cdp.profile_name_keys;
CREATE POLICY profile_name_keys_tenant_isolation ON cdp.profile_name_keys
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cdp_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON cdp.profile_name_keys TO cdp_svc;
  END IF;
END $g$;
