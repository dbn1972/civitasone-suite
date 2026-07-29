-- 0080_job_publication.sql
-- Job publication & career portal (checklist R-RA-0063/0067/0068/0069/0071).
--   • hrms_job_openings gains advertisement details (fees, documents, selection
--     process, important dates, bilingual title/description, portal scope) so the
--     public advert can show everything R-RA-0067 requires.
--   • hrms_vacancy_corrigenda is the immutable log of corrigenda / extensions /
--     cancellations that PRESERVES the original advertisement (R-RA-0068).
-- The closing deadline uses the existing job_openings.application_deadline.
-- Additive + idempotent.
--
-- Rollback: DROP TABLE IF EXISTS recruitment.hrms_vacancy_corrigenda;
--           ALTER TABLE recruitment.hrms_job_openings DROP COLUMN IF EXISTS fees_minor, ...;

-- The closing deadline must carry a precise date+TIME (R-RA-0063/0069). The
-- column was created as DATE in migration 0008, which would silently truncate the
-- time-of-day. Widen it to timestamptz (date values cast cleanly to midnight).
ALTER TABLE recruitment.hrms_job_openings
  ALTER COLUMN application_deadline TYPE timestamptz USING application_deadline::timestamptz;

ALTER TABLE recruitment.hrms_job_openings
  ADD COLUMN IF NOT EXISTS fees_minor         bigint,
  ADD COLUMN IF NOT EXISTS fee_exemption      text,
  ADD COLUMN IF NOT EXISTS required_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS selection_process  text,
  ADD COLUMN IF NOT EXISTS important_dates    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS portal_scope       varchar(16) NOT NULL DEFAULT 'public', -- public | internal | both
  ADD COLUMN IF NOT EXISTS title_alt          varchar(300),   -- bilingual title (R-RA-0066)
  ADD COLUMN IF NOT EXISTS description_alt     text,
  ADD COLUMN IF NOT EXISTS corrigendum_count  integer NOT NULL DEFAULT 0;

ALTER TABLE recruitment.hrms_job_openings
  DROP CONSTRAINT IF EXISTS hrms_job_openings_portal_scope_check;
ALTER TABLE recruitment.hrms_job_openings
  ADD CONSTRAINT hrms_job_openings_portal_scope_check
  CHECK (portal_scope IN ('public','internal','both'));

CREATE TABLE IF NOT EXISTS recruitment.hrms_vacancy_corrigenda (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  job_opening_id uuid NOT NULL,
  seq            integer NOT NULL,                 -- 1-based corrigendum number
  action         varchar(16) NOT NULL,             -- corrigendum | extension | cancellation
  changes        text NOT NULL,                    -- human description of what changed
  old_deadline   timestamptz,
  new_deadline   timestamptz,
  actor_id       uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_vacancy_corrigenda_action_check
    CHECK (action IN ('corrigendum','extension','cancellation'))
);
-- The corrigendum sequence is an immutable audit trail — enforce one row per
-- (tenant, vacancy, seq) at the DB layer (defense-in-depth beyond the route lock).
CREATE UNIQUE INDEX IF NOT EXISTS hrms_vacancy_corrigenda_seq_uq
  ON recruitment.hrms_vacancy_corrigenda (tenant_id, job_opening_id, seq);

ALTER TABLE recruitment.hrms_vacancy_corrigenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_vacancy_corrigenda FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_vacancy_corrigenda_tenant_isolation ON recruitment.hrms_vacancy_corrigenda;
CREATE POLICY hrms_vacancy_corrigenda_tenant_isolation ON recruitment.hrms_vacancy_corrigenda
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_vacancy_corrigenda TO hrms_svc;
