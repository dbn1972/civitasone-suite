-- 0056_estab_meeting_governance_link.sql
-- GAP-ESTAB-MEETINGS-DETAIL-04 (owner decision #30, 2026-10-26): the minutes of meeting (MOM) are produced
-- through meeting-service's existing minutes workflow (draft -> approve), not re-implemented here. An estab
-- meeting therefore keeps a LINK to the meeting-service meeting that carries its minutes. The link is a plain
-- uuid reference (no cross-service FK); one governance meeting backs at most one estab meeting per tenant.
-- Rollback: DROP INDEX IF EXISTS committee.uq_estab_meetings_governance;
--           ALTER TABLE committee.estab_meetings DROP COLUMN IF EXISTS governance_meeting_id;
-- Affected services: estab-service only. Additive nullable column: safe on a table of any size.

SET lock_timeout = '5s';

ALTER TABLE committee.estab_meetings
  ADD COLUMN IF NOT EXISTS governance_meeting_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_estab_meetings_governance
  ON committee.estab_meetings (tenant_id, governance_meeting_id)
  WHERE governance_meeting_id IS NOT NULL;
