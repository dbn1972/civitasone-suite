-- 0013_minutes_rejection.sql
-- Persist the chairperson's rejection of minutes. Previously the reason lived
-- only in the immutable minutes_versions.change_note ("rejected: ...") and the
-- reject event payload, so GET minutes could not return it and the secretary
-- who gets the draft back never saw why / when / by whom.
ALTER TABLE meeting.minutes
  ADD COLUMN IF NOT EXISTS rejection_comments text,
  ADD COLUMN IF NOT EXISTS rejected_at        timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by        uuid;
