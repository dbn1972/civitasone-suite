-- Delegation role scope (security): a delegation may satisfy a task's role gate
-- only for the roles it explicitly conveys, and the creator must have held each
-- of those roles when the delegation was created (validated against the
-- creator's token roles at POST time).
--
-- Additive + idempotent. Delegations created before this migration carry an
-- empty array and therefore satisfy NO role gate (fail closed); the delegator
-- must re-issue them with an explicit role scope.
ALTER TABLE workflow.workflow_delegations
  ADD COLUMN IF NOT EXISTS roles TEXT[] NOT NULL DEFAULT '{}';
