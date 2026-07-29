-- 0084_assessment_disposition_report.sql
-- Assessment management — disposition + reporting (checklist R-RA-0135/0136).
--   • hrms_assessment_attempts gains a disposition (malpractice / technical
--     disruption / reschedule / retest) so an attempt can be voided or superseded
--     with a reason + audit (R-RA-0135). Voided attempts free the candidate's slot
--     so a retest on the SAME schedule is possible (partial unique).
--   • Two more result-event actions (malpractice, reschedule) for the audit trail.
-- Reporting (R-RA-0136) is read-only aggregation over existing tables — no schema.
-- Additive + idempotent.
--
-- Rollback: ALTER TABLE assessment.hrms_assessment_attempts DROP COLUMN disposition, ...;

ALTER TABLE assessment.hrms_assessment_attempts
  ADD COLUMN IF NOT EXISTS disposition        varchar(24) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS disposition_reason text,
  ADD COLUMN IF NOT EXISTS disposition_by     uuid,
  ADD COLUMN IF NOT EXISTS disposition_at     timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by      uuid;   -- the replacement attempt, when rescheduled

ALTER TABLE assessment.hrms_assessment_attempts
  DROP CONSTRAINT IF EXISTS hrms_assessment_attempts_disposition_check;
ALTER TABLE assessment.hrms_assessment_attempts
  ADD CONSTRAINT hrms_assessment_attempts_disposition_check
  CHECK (disposition IN ('none','malpractice','technical_disruption','rescheduled','retest'));

-- A voided attempt no longer occupies the candidate's slot for the schedule, so a
-- reschedule/retest can create a fresh attempt on the same schedule.
DROP INDEX IF EXISTS assessment.hrms_assessment_attempts_cand_uq;
CREATE UNIQUE INDEX IF NOT EXISTS hrms_assessment_attempts_cand_uq
  ON assessment.hrms_assessment_attempts (tenant_id, schedule_id, candidate_id)
  WHERE status <> 'void';

-- Extend the result-event audit vocabulary.
ALTER TABLE assessment.hrms_assessment_result_events
  DROP CONSTRAINT IF EXISTS hrms_assessment_result_events_action_check;
ALTER TABLE assessment.hrms_assessment_result_events
  ADD CONSTRAINT hrms_assessment_result_events_action_check
  CHECK (action IN ('evaluate','consolidate','moderate_propose','moderate_approve','moderation_reset','freeze','publish','malpractice','reschedule'));
