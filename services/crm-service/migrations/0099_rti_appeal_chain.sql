-- GAP-CRM-RTI-DETAIL-01: the RTI appeal chain dead-ended. Once a first appeal
-- was raised (s.19(1) RTI Act) nothing could record the First Appellate
-- Authority's decision, escalate to the Information Commission (s.19(3)) or
-- dispose of the request, so FIRST_APPEAL / SECOND_APPEAL rows sat open
-- forever. These columns hold the statutory record of each step:
--
--   first_appeal_*   FAA order text, outcome, when and by whom it was decided
--   second_appeal_*  when the second appeal was recorded and its ground/ref
--   disposed_*       final closure date, reason and actor
--
-- The status CHECK (0081) already allows SECOND_APPEAL and DISPOSED, so no
-- constraint on status changes here.
--
-- Additive + idempotent: nullable columns only (existing rows stay valid);
-- the outcome CHECK is added guarded.
-- Rollback:
--   ALTER TABLE crm.rti_requests
--     DROP COLUMN IF EXISTS first_appeal_order,
--     DROP COLUMN IF EXISTS first_appeal_outcome,
--     DROP COLUMN IF EXISTS first_appeal_decided_at,
--     DROP COLUMN IF EXISTS first_appeal_decided_by,
--     DROP COLUMN IF EXISTS second_appeal_at,
--     DROP COLUMN IF EXISTS second_appeal_ref,
--     DROP COLUMN IF EXISTS disposed_at,
--     DROP COLUMN IF EXISTS disposal_reason,
--     DROP COLUMN IF EXISTS disposed_by;
SET lock_timeout = '5s';

ALTER TABLE crm.rti_requests
  ADD COLUMN IF NOT EXISTS first_appeal_order      text,
  ADD COLUMN IF NOT EXISTS first_appeal_outcome    text,
  ADD COLUMN IF NOT EXISTS first_appeal_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_appeal_decided_by uuid,
  ADD COLUMN IF NOT EXISTS second_appeal_at        timestamptz,
  ADD COLUMN IF NOT EXISTS second_appeal_ref       text,
  ADD COLUMN IF NOT EXISTS disposed_at             timestamptz,
  ADD COLUMN IF NOT EXISTS disposal_reason         text,
  ADD COLUMN IF NOT EXISTS disposed_by             uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rti_requests_first_appeal_outcome_check'
  ) THEN
    ALTER TABLE crm.rti_requests
      ADD CONSTRAINT rti_requests_first_appeal_outcome_check
      CHECK (first_appeal_outcome IS NULL
             OR first_appeal_outcome IN ('allowed', 'partly_allowed', 'dismissed'));
  END IF;
END $$;
