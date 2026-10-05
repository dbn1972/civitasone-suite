-- Purpose: GAP-CRM-SERVICE-REQUESTS-DETAIL-01.
--   Every status transition (Mark pending, Close) used to overload the single
--   `resolution` column with its reason, so a pending request showed a bogus
--   "Resolution" card and a Close overwrote the genuine resolution text. Add a
--   separate `status_note` column that carries the non-resolution reason
--   (what a request is waiting on when pending; closing remarks when closed),
--   leaving `resolution` to mean strictly "how the request was fulfilled".
-- Rollback: ALTER TABLE crm.service_requests DROP COLUMN IF EXISTS status_note;
-- Affected services: crm-service (service-requests module)

SET lock_timeout = '5s';

ALTER TABLE crm.service_requests
  ADD COLUMN IF NOT EXISTS status_note text;
