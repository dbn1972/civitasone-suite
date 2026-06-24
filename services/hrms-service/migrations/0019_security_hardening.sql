-- 0019_security_hardening.sql
-- SECURITY remediation: C1 (GPF negative-balance backstop), C2 (APAR SoD
-- override audit columns), M2 (APAR stage-history DB-enforced immutability).
-- Additive + idempotent only. Applied with hrms_svc role on civitas_hrms.

-- ---------------------------------------------------------------------------
-- C1: GPF ledger balance can never persist negative (DB backstop).
-- The running balance is carried on every ledger row; enforce it is >= 0.
-- ---------------------------------------------------------------------------
ALTER TABLE gpf.hrms_gpf_ledger DROP CONSTRAINT IF EXISTS hrms_gpf_ledger_balance_nonneg;
ALTER TABLE gpf.hrms_gpf_ledger
  ADD CONSTRAINT hrms_gpf_ledger_balance_nonneg CHECK (balance_minor >= 0);

-- ---------------------------------------------------------------------------
-- C2: APAR stage-history must record the TRUE acting actor + role and whether
-- the action was a privileged super_admin override of the assigned stage owner.
-- ---------------------------------------------------------------------------
ALTER TABLE appraisal.hrms_apar_stage_history
  ADD COLUMN IF NOT EXISTS override boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- M2: APAR stage-history is append-only at the DB level (mirror workflow
-- service's transition_history). Block UPDATE and DELETE via trigger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION appraisal.block_apar_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'appraisal.hrms_apar_stage_history is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_apar_history_no_mutation ON appraisal.hrms_apar_stage_history;
CREATE TRIGGER trg_apar_history_no_mutation
  BEFORE UPDATE OR DELETE ON appraisal.hrms_apar_stage_history
  FOR EACH ROW EXECUTE FUNCTION appraisal.block_apar_history_mutation();
