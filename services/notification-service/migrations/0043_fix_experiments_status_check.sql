-- ============================================================================
-- 0043_fix_experiments_status_check.sql
--
-- PURPOSE
--   Repairs a latent defect that makes the winner-approval-gate feature
--   (P2-9) impossible to persist. Not a new feature — a correctness fix,
--   same class as 0027 and 0030.
--
--   Migration 0026 declares the admissible set for
--   experiments.experiments.status as:
--     CHECK (status IN ('draft', 'running', 'concluded'))
--   via constraint chk_experiments_status. But src/modules/experiments/
--   domain.ts and consumer.ts implement a four-state lifecycle:
--     draft -> running -> pending_approval -> concluded
--   COMMANDS.requestWinnerApproval's handler (consumer.ts) calls
--     repo.setStatus(tx, tenantId, id, "pending_approval", actorId, version)
--   which UPDATEs experiments.experiments.status to 'pending_approval' — a
--   value the CHECK constraint above does not permit.
--
--   Consequence: any request-winner-approval command fails at the database
--   with a check-constraint violation, the transaction rolls back, and the
--   experiment is left stuck at 'running' forever — the approval gate can
--   never be entered, let alone satisfied. concludeExperiment's own gate
--   (`experiment.status !== "pending_approval"`) can then never pass either,
--   since nothing can legally reach that state.
--
--   Why this was never caught: tests/experiments-approval-gate.test.ts only
--   unit-tests the pure functions assertCanRequestConclusion /
--   assertCanApproveWinner in domain.ts — no database involved, so the
--   constraint gap is invisible there. tests/experiments-routes.test.ts does
--   hit the real Postgres constraint, but its concludeExperiment cases seed
--   experiments directly at status 'running' and never route through
--   requestWinnerApproval first, so they never attempt to persist
--   'pending_approval' either — a pre-existing test gap fixed alongside this
--   migration.
--
-- WHY THIS IS SAFE
--   * A CHECK constraint is dropped and immediately re-added — no table, no
--     column, no data is touched.
--   * The new set is a strict SUPERSET of the previous definition, so no
--     existing row can be invalidated. VALIDATE therefore cannot fail.
--   * The column stays constrained: it is never left without a CHECK.
--   * Idempotent — re-running produces the same constraint.
--
-- Rollback: ALTER TABLE experiments.experiments
--             DROP CONSTRAINT IF EXISTS chk_experiments_status;
--           ALTER TABLE experiments.experiments
--             ADD CONSTRAINT chk_experiments_status
--             CHECK (status IN ('draft', 'running', 'concluded'));
--           (Only safe once no row holds 'pending_approval'.)
-- Affected services: notification-service (experiments module)
-- ============================================================================
SET lock_timeout = '5s';

ALTER TABLE experiments.experiments
  DROP CONSTRAINT IF EXISTS chk_experiments_status;

ALTER TABLE experiments.experiments
  ADD CONSTRAINT chk_experiments_status
  CHECK (status IN ('draft', 'running', 'pending_approval', 'concluded'))
  NOT VALID;

ALTER TABLE experiments.experiments
  VALIDATE CONSTRAINT chk_experiments_status;
