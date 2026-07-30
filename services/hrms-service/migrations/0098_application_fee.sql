-- 0098_application_fee.sql
-- Application fee — assessment / exemption / payment (checklist R-RA-0099).
--   recruitment.hrms_application_fees — one fee record per application. Exempt
--   (amount 0), pending, paid (manual/offline reference, or gateway when wired)
--   or refunded. amount_minor is bigint paise. The online payment gateway is an
--   external seam (deferred) — manual/offline payment recording is supported now.
-- Additive + idempotent. FORCE RLS on app.tenant_id GUC (recruitment schema).
--
-- Rollback: DROP TABLE IF EXISTS recruitment.hrms_application_fees;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS recruitment.hrms_application_fees (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  application_id   uuid NOT NULL,
  job_opening_id   uuid NOT NULL,
  amount_minor     bigint NOT NULL DEFAULT 0,
  currency         varchar(3) NOT NULL DEFAULT 'INR',
  status           varchar(10) NOT NULL DEFAULT 'pending',
  exemption_reason varchar(64),
  provider         varchar(10) NOT NULL DEFAULT 'none',
  payment_ref      varchar(128),
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_application_fees_status_check
    CHECK (status IN ('pending','exempt','paid','refunded')),
  CONSTRAINT hrms_application_fees_provider_check
    CHECK (provider IN ('manual','gateway','none')),
  CONSTRAINT hrms_application_fees_amount_check
    CHECK (amount_minor >= 0)
);

-- One fee record per application (business key).
CREATE UNIQUE INDEX IF NOT EXISTS hrms_application_fees_app_uq
  ON recruitment.hrms_application_fees (tenant_id, application_id);

ALTER TABLE recruitment.hrms_application_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_application_fees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_application_fees_tenant_isolation ON recruitment.hrms_application_fees;
CREATE POLICY hrms_application_fees_tenant_isolation ON recruitment.hrms_application_fees
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_application_fees TO hrms_svc;
