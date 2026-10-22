-- GAP-CRM-RTI-DETAIL-04: a s.6(3) transfer (Forward) overwrote department_ref and
-- kept no record of where the request came from, so the detail page could not
-- say "Transferred from X on <date>" and the only trace was the destination in
-- the history note. These two nullable columns hold the origin of the LATEST
-- transfer:
--
--   previous_department_ref  the department_ref the request held just before it
--                            was forwarded (NULL = never transferred)
--   transferred_at           when that transfer happened
--
-- Written by rti-repo forwardRti in the same statement that changes
-- department_ref; surfaced on GET /v1/crm/rti/:id. A chain of transfers keeps
-- only the most recent hop here -- the full chain stays in
-- crm.case_status_history (the note now reads "Transferred from X to Y").
--
-- Additive + idempotent: nullable columns only, existing rows stay valid.
-- Rollback:
--   ALTER TABLE crm.rti_requests
--     DROP COLUMN IF EXISTS previous_department_ref,
--     DROP COLUMN IF EXISTS transferred_at;
SET lock_timeout = '5s';

ALTER TABLE crm.rti_requests
  ADD COLUMN IF NOT EXISTS previous_department_ref text,
  ADD COLUMN IF NOT EXISTS transferred_at          timestamptz;
