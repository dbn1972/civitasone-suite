-- 0020_rti_appeal_disposal_deadline.sql
-- FIX (RTI second-appeal deadline): the appeal deadline conflated the RTI Act
-- s.19(3) FILING window (90 days from the first-appeal order date) with a
-- disposal deadline. A second appeal has NO statutory disposal window, so
-- rti_appeals.deadline_at is now NULLABLE (NULL = no disposal deadline).
-- First-appeal rows keep their s.19(6) 30-day disposal deadline.
ALTER TABLE rti.rti_appeals ALTER COLUMN deadline_at DROP NOT NULL;

COMMENT ON COLUMN rti.rti_appeals.deadline_at IS
  'Statutory disposal deadline. First appeal: filed_at + 30d (s.19(6)). Second appeal: NULL (no statutory disposal window; the s.19(3) 90d is a filing window, not a disposal deadline).';
