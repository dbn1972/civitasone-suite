-- 0265_leave_rejection_reason.sql
--
-- UAT deep lane W8 (A-UI-LV-006): a rejected leave's reason was only carried to the
-- applicant notification and the workflow task history, so the employee's leave
-- history showed "Rejected" with no explanation. The reason is now stored on the
-- application row (set by the leave reject consumer, whichever path rejected it:
-- HR direct reject or the approver's workflow reject) and returned by the leave
-- applications list. Additive, nullable.
--
-- Rollback:
--   ALTER TABLE leave.hrms_leave_apps DROP COLUMN IF EXISTS rejection_reason;

SET lock_timeout = '5s';

ALTER TABLE leave.hrms_leave_apps ADD COLUMN IF NOT EXISTS rejection_reason text;
