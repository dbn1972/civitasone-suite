-- Purpose: REL-033 -- widen committee_vote_unique to include tenant_id, closing the
-- cross-tenant collision gap left by REL-032's query-level fix. REL-032 made
-- castVoteTx's own queries (duplicate-check + recompute-tally) filter on tenantId,
-- matching listVotes/findDecisionWithVotes -- but the DB constraint enforcing
-- one-vote-per-voter, committee_vote_unique UNIQUE (decision_id, voter_id), still did
-- not include tenant_id, unlike the tenant-scoped uniqueness pattern already used
-- elsewhere in this codebase (e.g. working_calendar_code_unique UNIQUE (tenant_id,
-- code) a few lines above it in migration 0028, or definitions_tenant_code_version_key
-- in migration 0005).
--
-- In practice inert today: decision_id is 1:1 with a single tenant through every
-- legitimate application code path, and no code path outside a direct DB write that
-- bypasses castVoteTx can construct a cross-tenant (decision_id, voter_id) collision.
-- But if a stray/poisoned committee_votes row belonging to a DIFFERENT tenant ever
-- existed at the same (decision_id, voter_id) -- a bug elsewhere, a migration issue --
-- a genuine, first-time voter's legitimate INSERT would collide with it under the old
-- constraint and surface as a raw, unhandled PostgresError (23505 unique_violation)
-- instead of succeeding cleanly, even though castVoteTx's own (now tenant-scoped)
-- duplicate-check correctly determined this voter had never voted before. Live-
-- reproduced pre-fix (see PR description): seeding exactly such a poisoned row and
-- calling the real castVoteTx throws `duplicate key value violates unique constraint
-- "committee_vote_unique"` for a voter who has genuinely never voted on this decision.
--
-- Verified live that this is NOT mitigated by Row Level Security, unlike REL-032's
-- read-side gap: committee_votes carries a FORCE RLS tenant_isolation_policy, and the
-- real `workflow_svc` login role (NOBYPASSRLS) genuinely cannot SELECT the poisoned
-- row at all (0 rows visible under its own tenant's app.tenant_id GUC) -- yet the same
-- role's plain INSERT for the genuine voter still hit this exact unique-violation.
-- Postgres enforces unique constraints against the underlying physical index
-- unconditionally; RLS only filters what a query result set can see, so a row being
-- fully invisible to a role provides no protection at all against that role's own
-- INSERT colliding with it. See rel-033-committee-vote-unique-tenant-scoped.test.ts.
--
-- Fix: widen the constraint to UNIQUE (tenant_id, decision_id, voter_id). This is a
-- pure widening (strictly less restrictive on the existing two-column combination),
-- so every existing row already satisfies it -- not a data-rejecting change -- while
-- still fully enforcing the real invariant (one vote per voter per decision within a
-- tenant). A poisoned cross-tenant row at the same (decision_id, voter_id) no longer
-- collides with a different tenant's genuine row at all, so the genuine voter's INSERT
-- now just succeeds -- this makes the collision cleanly impossible rather than merely
-- caught-and-handled, which also avoids the alternative fix's failure mode (a generic
-- catch in castVoteTx cannot safely collapse this into `duplicate: true` without
-- lying to a genuine first-time voter -- exactly the silent-wrong-answer class of bug
-- REL-031/REL-032 were about).
--
-- Additive-in-effect + idempotent: DROP CONSTRAINT IF EXISTS + a guarded ADD, matching
-- the established precedent for widening a UNIQUE constraint's column set in this same
-- service (migration 0005_engine_hardening.sql, definitions_tenant_id_code_key ->
-- definitions_tenant_code_version_key).
-- Rollback: ALTER TABLE workflow.committee_votes DROP CONSTRAINT IF EXISTS committee_vote_unique;
--           then re-add the narrower original: ALTER TABLE workflow.committee_votes
--           ADD CONSTRAINT committee_vote_unique UNIQUE (decision_id, voter_id)
--           (only safe if no cross-tenant collision rows exist at that point).
-- Affected services: workflow-service

SET lock_timeout = '5s';

ALTER TABLE workflow.committee_votes DROP CONSTRAINT IF EXISTS committee_vote_unique;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'committee_vote_unique'
  ) THEN
    ALTER TABLE workflow.committee_votes
      ADD CONSTRAINT committee_vote_unique UNIQUE (tenant_id, decision_id, voter_id);
  END IF;
END $$;
