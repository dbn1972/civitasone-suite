-- 0100_nominee_address_leave_conversion.sql
-- Sprint 1 defects T04/T05/T08:
--   T04 (DEF-EM-003): employee.hrms_employee_nominees — next of kin / dependant.
--   T05 (DEF-EM-002): employee.hrms_employee_addresses — multi-address with history.
--   T08 (DEF-LM-001): leave.hrms_leave_conversions — type-to-type conversion.
-- Additive + idempotent. FORCE RLS on app.tenant_id GUC.
--
-- Rollback:
--   DROP TABLE IF EXISTS employee.hrms_employee_nominees;
--   DROP TABLE IF EXISTS employee.hrms_employee_addresses;
--   DROP TABLE IF EXISTS leave.hrms_leave_conversions;

SET lock_timeout = '5s';

-- ── T04: nominees ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee.hrms_employee_nominees (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  employee_id    uuid NOT NULL,
  name           varchar(200) NOT NULL,
  relationship   varchar(64) NOT NULL,
  date_of_birth  date,
  share_percent  integer,
  contact_phone  varchar(20),
  purpose        varchar(32) NOT NULL DEFAULT 'general',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_nominees_share_check CHECK (share_percent IS NULL OR (share_percent >= 0 AND share_percent <= 100))
);
CREATE INDEX IF NOT EXISTS hrms_nominees_emp_idx ON employee.hrms_employee_nominees (tenant_id, employee_id);
ALTER TABLE employee.hrms_employee_nominees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_employee_nominees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_nominees_tenant_isolation ON employee.hrms_employee_nominees;
CREATE POLICY hrms_nominees_tenant_isolation ON employee.hrms_employee_nominees
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON employee.hrms_employee_nominees TO hrms_svc;

-- ── T05: addresses ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee.hrms_employee_addresses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  employee_id    uuid NOT NULL,
  address_type   varchar(16) NOT NULL,
  line1          text NOT NULL,
  line2          text,
  city           varchar(100),
  state          varchar(100),
  pincode        varchar(10),
  country        varchar(64) NOT NULL DEFAULT 'IN',
  is_current     boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_addresses_type_check CHECK (address_type IN ('permanent','correspondence','present','hometown'))
);
CREATE INDEX IF NOT EXISTS hrms_addresses_emp_idx ON employee.hrms_employee_addresses (tenant_id, employee_id);
ALTER TABLE employee.hrms_employee_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_employee_addresses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_addresses_tenant_isolation ON employee.hrms_employee_addresses;
CREATE POLICY hrms_addresses_tenant_isolation ON employee.hrms_employee_addresses
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON employee.hrms_employee_addresses TO hrms_svc;

-- ── T08: leave-type conversions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave.hrms_leave_conversions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  employee_id    uuid NOT NULL,
  from_alloc_id  uuid NOT NULL,
  to_alloc_id    uuid NOT NULL,
  days           integer NOT NULL,
  reason         text,
  status         varchar(12) NOT NULL DEFAULT 'approved',
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_leave_conversions_days_check CHECK (days > 0),
  CONSTRAINT hrms_leave_conversions_status_check CHECK (status IN ('approved','reversed'))
);
CREATE INDEX IF NOT EXISTS hrms_leave_conversions_emp_idx ON leave.hrms_leave_conversions (tenant_id, employee_id);
ALTER TABLE leave.hrms_leave_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_conversions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_leave_conversions_tenant_isolation ON leave.hrms_leave_conversions;
CREATE POLICY hrms_leave_conversions_tenant_isolation ON leave.hrms_leave_conversions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON leave.hrms_leave_conversions TO hrms_svc;

-- ── T07: candidate job alert subscriptions ─────────────────────────────────
CREATE TABLE IF NOT EXISTS recruitment.hrms_job_alerts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  candidate_id   uuid NOT NULL,
  criteria       jsonb NOT NULL DEFAULT '{}'::jsonb,
  channel        varchar(8) NOT NULL DEFAULT 'email',
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_job_alerts_channel_check CHECK (channel IN ('email','sms','push'))
);
CREATE INDEX IF NOT EXISTS hrms_job_alerts_cand_idx ON recruitment.hrms_job_alerts (tenant_id, candidate_id);
ALTER TABLE recruitment.hrms_job_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_job_alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_job_alerts_tenant_isolation ON recruitment.hrms_job_alerts;
CREATE POLICY hrms_job_alerts_tenant_isolation ON recruitment.hrms_job_alerts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_job_alerts TO hrms_svc;
