-- 0162: training.hrms_trainings -- add category / mode / enrollment deadline.
--
-- GAP-HR-TRAINING-NEW-02: the New Training Program form has no way to record
-- category (mandatory/optional/leadership), mode (online/classroom/blended)
-- or an enrolment deadline, so training/queries.ts hard-coded
-- category:'general' for every row and the web layer GUESSED a category
-- (defaulting anything unrecognised to "Mandatory" -- a compliance label
-- with no data behind it, GAP-HR-TRAINING-02) and a mode (from venue text
-- keywords, GAP-HR-TRAINING-03). Both guesses are removed in the same PR
-- that adds this migration; the API now returns the real stored value, or
-- null when genuinely unset.
--
-- Existing rows backfill to NULL, never 'mandatory' -- a silent default
-- would relabel every already-scheduled programme as compulsory with no
-- actual policy behind it, which is exactly the mislabelling the gap
-- catalog flagged as a compliance risk.
ALTER TABLE training.hrms_trainings
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS mode TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_deadline DATE;

ALTER TABLE training.hrms_trainings
  ADD CONSTRAINT hrms_trainings_category_check
    CHECK (category IS NULL OR category IN ('mandatory', 'optional', 'leadership'));

ALTER TABLE training.hrms_trainings
  ADD CONSTRAINT hrms_trainings_mode_check
    CHECK (mode IS NULL OR mode IN ('online', 'classroom', 'blended'));

-- Deadline must not fall after the programme itself starts. NULL (no
-- deadline recorded) is always allowed -- this campaign's existing rows,
-- and any future row where HR chooses not to set one.
ALTER TABLE training.hrms_trainings
  ADD CONSTRAINT hrms_trainings_enrollment_deadline_check
    CHECK (enrollment_deadline IS NULL OR enrollment_deadline <= from_date);
