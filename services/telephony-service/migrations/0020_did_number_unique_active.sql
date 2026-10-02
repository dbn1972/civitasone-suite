-- 0020_did_number_unique_active.sql
-- At most one ACTIVE mapping per (normalised) DID number, across ALL tenants.
--
-- 0010 created only non-unique indexes on telephony.did_mappings, and nothing
-- else stopped a second tenant mapping a number another tenant already owns.
-- Once 0019 made the cross-tenant resolver actually see every tenant's rows,
-- such a duplicate would let tenant B receive tenant A's inbound calls
-- (resolution used to take the first active match, unordered). This index
-- makes the conflict impossible; did/commands.ts answers 409
-- DID_NUMBER_ASSIGNED up front and the consumer dead-letters the race loser.
--
-- The indexed expression is IDENTICAL to the normalisation in
-- telephony.did_mappings_for_number() (0014) and matches normalizeNumber() in
-- src/modules/did/domain.ts: strip whitespace, '(', ')' and '-'.
--
-- If active duplicates already exist, the index build fails; this migration
-- then ABORTS with a clear error instead of silently picking a winner.
-- Resolve by deactivating (active = false) every mapping except the rightful
-- owner's, then re-run. Inactive rows are not constrained.
--
-- Runs as the table owner (telephony_svc in CI via
-- scripts/ci/bootstrap-postgres.sh) or a superuser; it needs no superuser
-- privilege. The index build reads every row regardless of RLS.
-- Idempotent: IF NOT EXISTS.
--
-- Rollback: DROP INDEX IF EXISTS telephony.ux_did_mappings_active_number;
SET lock_timeout = '5s';

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS ux_did_mappings_active_number
    ON telephony.did_mappings ((regexp_replace(did_number, '[\s()-]', '', 'g')))
    WHERE active;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION
    'telephony 0020: more than one ACTIVE did_mappings row shares a normalised DID number (%). Deactivate all but the rightful owner''s mapping for each such number, then re-run this migration.',
    SQLERRM;
END
$$;
