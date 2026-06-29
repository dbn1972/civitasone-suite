-- hrms-service: add 'pending_approval' to the disciplinary case status check.
-- Forward-only, idempotent.
--
-- The disciplinary state machine and the eOffice approval loop move a case to
-- `pending_approval` while the proposed penalty is under administrative
-- approval (submit_for_approval → pending_approval → penalty_imposed/dropped).
-- Migration 0022's CHECK constraint omitted this state, so persisting a
-- submit-for-approval failed at the DB. Recreate the constraint with the state
-- included. (R19 + latent fix.)

ALTER TABLE disciplinary.hrms_disciplinary_cases
  DROP CONSTRAINT IF EXISTS hrms_disc_cases_status_check;

ALTER TABLE disciplinary.hrms_disciplinary_cases
  ADD CONSTRAINT hrms_disc_cases_status_check CHECK (status IN
    ('opened','charge_memo_issued','inquiry_appointed','finding_recorded',
     'pending_approval','penalty_imposed','appeal_filed','appeal_decided',
     'closed','dropped'));
