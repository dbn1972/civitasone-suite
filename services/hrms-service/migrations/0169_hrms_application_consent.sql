-- 0169_hrms_application_consent.sql
--
-- GAP-RECRUITMENT-CAREERS-DETAIL-02 (DPDP): record the candidate's consent to the
-- recruitment privacy notice on the public apply path. consent_version names the
-- notice text the candidate saw so a later wording change is auditable. Both are
-- NULL for rows created before this migration and for internal (HR-entered)
-- applications, which are not covered by a candidate-facing notice.
ALTER TABLE recruitment.hrms_applications ADD COLUMN IF NOT EXISTS consent_given_at timestamptz;
ALTER TABLE recruitment.hrms_applications ADD COLUMN IF NOT EXISTS consent_version varchar(32);
