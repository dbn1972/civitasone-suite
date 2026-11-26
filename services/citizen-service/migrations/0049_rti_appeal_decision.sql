-- citizen-service migration 0049 - D2 (CITIZEN-RTI-DETAIL-06): first-appeal decision by the appellate authority.
--
-- rti.citizen_rti_appeals gains the decision record written by a user holding the
-- rti_appellate realm role: outcome (allowed | partly_allowed | rejected | remanded),
-- the hearing date, the decision date and the reasons. status moves filed -> decided.
-- All new columns are nullable, so existing appeals (never decided) stay valid.
--
-- Additive + idempotent. DDL only (no DML), so no NO FORCE / FORCE wrap needed.

ALTER TABLE rti.citizen_rti_appeals
  ADD COLUMN IF NOT EXISTS outcome         varchar(16),
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS hearing_date    date,
  ADD COLUMN IF NOT EXISTS decision_date   date,
  ADD COLUMN IF NOT EXISTS decided_by      uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rti_appeals_outcome') THEN
    ALTER TABLE rti.citizen_rti_appeals
      ADD CONSTRAINT chk_rti_appeals_outcome
      CHECK (outcome IS NULL OR outcome IN ('allowed','partly_allowed','rejected','remanded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rti_appeals_decided_complete') THEN
    ALTER TABLE rti.citizen_rti_appeals
      ADD CONSTRAINT chk_rti_appeals_decided_complete
      CHECK (status <> 'decided' OR (outcome IS NOT NULL AND decision_date IS NOT NULL AND decided_by IS NOT NULL));
  END IF;
END $$;
