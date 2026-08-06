-- ============================================================================
-- Purpose (G15 / spec §25.7 J6-3, §25.2 J1-4):
--   Extend the EXISTING contracts.contract_milestones table with the MoU
--   governance attributes the agreement repository needs: a stable business
--   code, a description, an explicit ordinal, a completion timestamp and a
--   full waiver record (who waived, when, why).
--
--   A NEW milestone table is deliberately NOT created. contracts.contract_
--   milestones already exists (migration 0001, extended by 0014) and already
--   carries contract_id, tenant_id, title, due_date, amount_minor, currency,
--   status and the standard entity columns. Duplicating it would violate the
--   "no duplicate functionality" project rule. See
--   src/modules/milestones/README.md for the full decision record.
--
--   The status CHECK is widened to admit the MoU vocabulary
--   ('met', 'missed', 'waived') alongside the pre-existing procurement
--   vocabulary ('completed', 'completed_late', 'overdue', 'cancelled').
--   Widening is a superset: no existing row can become invalid.
--
--   A UNIQUE index on (tenant_id, contract_id, milestone_code) is the
--   database-level business key that stops the same MoU milestone (and
--   therefore the same milestone payment) being registered twice.
--
-- Rollback steps (manual, requires tech-lead approval per steering):
--   SET lock_timeout = '5s';
--   DROP INDEX IF EXISTS contracts.uq_contract_milestones_code;
--   DROP INDEX IF EXISTS contracts.idx_contract_milestones_tenant_due;
--   ALTER TABLE contracts.contract_milestones
--     DROP CONSTRAINT IF EXISTS contract_milestones_status_check;
--   ALTER TABLE contracts.contract_milestones
--     ADD CONSTRAINT contract_milestones_status_check
--     CHECK (status IN ('pending','completed','completed_late','overdue','cancelled'));
--   ALTER TABLE contracts.contract_milestones
--     DROP COLUMN IF EXISTS milestone_code,
--     DROP COLUMN IF EXISTS description,
--     DROP COLUMN IF EXISTS ordinal,
--     DROP COLUMN IF EXISTS completed_at,
--     DROP COLUMN IF EXISTS waived_by,
--     DROP COLUMN IF EXISTS waived_at,
--     DROP COLUMN IF EXISTS waiver_reason;
--
-- Affected services: contract-service (owner).
--   Downstream consumers of contract.milestone.* events (notification-service,
--   workflow-service) gain new optional payload fields only; no field is
--   removed or renamed, so old consumers keep working.
-- ============================================================================

SET lock_timeout = '5s';

-- ── New MoU governance columns (all nullable / defaulted → additive) ────────
ALTER TABLE contracts.contract_milestones
  ADD COLUMN IF NOT EXISTS milestone_code varchar(64);

ALTER TABLE contracts.contract_milestones
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';

ALTER TABLE contracts.contract_milestones
  ADD COLUMN IF NOT EXISTS ordinal integer NOT NULL DEFAULT 1;

ALTER TABLE contracts.contract_milestones
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE contracts.contract_milestones
  ADD COLUMN IF NOT EXISTS waived_by uuid;

ALTER TABLE contracts.contract_milestones
  ADD COLUMN IF NOT EXISTS waived_at timestamptz;

ALTER TABLE contracts.contract_milestones
  ADD COLUMN IF NOT EXISTS waiver_reason text;

-- A waiver must always name an actor and a reason. Enforced at the database
-- level so an application bug cannot record an unattributable waiver.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contract_milestones_waiver_complete_check'
      AND conrelid = 'contracts.contract_milestones'::regclass
  ) THEN
    ALTER TABLE contracts.contract_milestones
      ADD CONSTRAINT contract_milestones_waiver_complete_check
      CHECK (
        status <> 'waived'
        OR (waived_by IS NOT NULL AND waiver_reason IS NOT NULL AND length(btrim(waiver_reason)) > 0)
      )
      NOT VALID;
  END IF;
END $$;

-- ── Widen the status vocabulary (superset of the 0005 constraint) ───────────
-- Not a destructive ALTER TYPE: the column stays varchar(24); only the CHECK
-- predicate is relaxed to admit three additional values.
ALTER TABLE contracts.contract_milestones
  DROP CONSTRAINT IF EXISTS contract_milestones_status_check;

ALTER TABLE contracts.contract_milestones
  ADD CONSTRAINT contract_milestones_status_check
  CHECK (status IN (
    'pending',          -- registered, not yet due/assessed
    'met',              -- MoU vocabulary: delivered on or before due date
    'missed',           -- MoU vocabulary: due date passed undelivered
    'waived',           -- MoU vocabulary: missed but excused with a reason
    'completed',        -- pre-existing procurement vocabulary (on time)
    'completed_late',   -- pre-existing procurement vocabulary (late, penalised)
    'overdue',          -- pre-existing procurement vocabulary
    'cancelled'         -- pre-existing procurement vocabulary
  ))
  NOT VALID;

ALTER TABLE contracts.contract_milestones
  VALIDATE CONSTRAINT contract_milestones_status_check;

ALTER TABLE contracts.contract_milestones
  VALIDATE CONSTRAINT contract_milestones_waiver_complete_check;

-- ── Business key: one milestone_code per contract per tenant ────────────────
-- Partial index so pre-existing rows (milestone_code IS NULL) are unaffected.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_contract_milestones_code
  ON contracts.contract_milestones (tenant_id, contract_id, milestone_code)
  WHERE milestone_code IS NOT NULL;

-- Due-date sweep index for the milestone-due / milestone-missed scanner.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_milestones_tenant_due
  ON contracts.contract_milestones (tenant_id, status, due_date);
