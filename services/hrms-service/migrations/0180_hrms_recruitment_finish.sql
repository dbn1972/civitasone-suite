-- 0180_hrms_recruitment_finish.sql
--
-- fin-recruitment-01 finish batch. Additive + idempotent.
--
--  * recruitment.hrms_recruitment_settings (one row per tenant): public organisation
--    identity for the careers pages (GAP-RECRUITMENT-CAREERS-HOME-02 / PORTAL-LOGIN-02),
--    the offer-workflow policy flag (GAP-RECRUITMENT-DETAIL-05, default ON = every
--    offer goes through the maker-checker approval chain) and the applicant-data
--    purpose/retention note shown on the talent pool (GAP-RECRUITMENT-TALENT-POOL-02).
--  * hrms_reservation_rosters.horizontal_vacancies: horizontal reservations
--    (PwBD / ex-servicemen / women) sanctioned for the post (GAP-RECRUITMENT-DETAIL-03).
--  * hrms_offers.pay_level / pay_cell: 7th-CPC pay-matrix coordinates (GAP-RECRUITMENT-DETAIL-05).
--
-- Rollback: DROP TABLE recruitment.hrms_recruitment_settings;
--   ALTER TABLE recruitment.hrms_reservation_rosters DROP COLUMN horizontal_vacancies;
--   ALTER TABLE recruitment.hrms_offers DROP COLUMN pay_level, DROP COLUMN pay_cell;

CREATE TABLE IF NOT EXISTS recruitment.hrms_recruitment_settings (
  tenant_id               uuid PRIMARY KEY,
  organisation_name       varchar(200),
  department_name         varchar(200),
  emblem_url              text,
  offer_workflow_required boolean NOT NULL DEFAULT true,
  applicant_purpose_note  text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NOT NULL,
  version                 integer NOT NULL DEFAULT 1
);

ALTER TABLE recruitment.hrms_recruitment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_recruitment_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_recruitment_settings_tenant_isolation ON recruitment.hrms_recruitment_settings;
CREATE POLICY hrms_recruitment_settings_tenant_isolation ON recruitment.hrms_recruitment_settings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_recruitment_settings TO hrms_svc;

ALTER TABLE recruitment.hrms_reservation_rosters
  ADD COLUMN IF NOT EXISTS horizontal_vacancies jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE recruitment.hrms_offers ADD COLUMN IF NOT EXISTS pay_level varchar(8);
ALTER TABLE recruitment.hrms_offers ADD COLUMN IF NOT EXISTS pay_cell integer;
