-- HRMS gap: align appraisal status CHECK to the 5 APAR workflow stages (was 500ing every APAR write).
ALTER TABLE appraisal.hrms_appraisals DROP CONSTRAINT IF EXISTS hrms_appraisals_status_check;
ALTER TABLE appraisal.hrms_appraisals ADD CONSTRAINT hrms_appraisals_status_check
  CHECK (status IN ('pending','in_review','completed','self_pending','reporting_officer','reviewing_officer','accepting_authority'));
