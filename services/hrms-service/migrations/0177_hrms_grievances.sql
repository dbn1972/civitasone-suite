-- 0177_hrms_grievances.sql
--
-- GAP-HR-GRIEVANCE-01/02/03/06: the employee grievance register. GET
-- /v1/hrms/grievances used to be a permanent stub (always `data: []`); this
-- adds the real tables.
--
--  * hrms_grievances         one row per grievance. case_no is a per-tenant,
--                            per-year sequential number GRV/YYYY/NNNN (unique
--                            per tenant). status is the shared register state
--                            machine: registered -> under_inquiry -> disposed
--                            (assignment moves registered -> under_inquiry).
--  * hrms_grievance_events   append-only history (register / assign / dispose).
--  * hrms_grievance_seq      atomic per-(tenant, year) counter behind case_no.
--
-- `category` is a COARSE code only (the free-text subject/description is only
-- ever returned by the detail endpoint, DPDP). Additive + idempotent.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS employee.hrms_grievances (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid         NOT NULL,
  case_no            varchar(24)  NOT NULL,
  employee_id        uuid         NOT NULL,
  category           varchar(32)  NOT NULL,
  subject            varchar(200) NOT NULL,
  description        text         NOT NULL,
  filed_date         date         NOT NULL,
  status             varchar(16)  NOT NULL DEFAULT 'registered',
  assigned_to        uuid,
  assigned_at        timestamptz,
  disposition        varchar(24),
  disposal_remarks   text,
  disposed_at        timestamptz,
  disposed_by        uuid,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  created_by         uuid         NOT NULL,
  updated_by         uuid         NOT NULL,
  version            integer      NOT NULL DEFAULT 1
);

DO $$ BEGIN
  ALTER TABLE employee.hrms_grievances ADD CONSTRAINT hrms_grievances_status_chk
    CHECK (status IN ('registered','under_inquiry','disposed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE employee.hrms_grievances ADD CONSTRAINT hrms_grievances_category_chk
    CHECK (category IN ('workplace_conduct','pay_allowances','leave_attendance','transfer_posting',
                        'promotion_service','facilities','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE employee.hrms_grievances ADD CONSTRAINT hrms_grievances_disposition_chk
    CHECK (disposition IS NULL OR disposition IN ('resolved','not_substantiated','referred','withdrawn'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- A disposed row always carries its disposition + remarks; an open row never does.
DO $$ BEGIN
  ALTER TABLE employee.hrms_grievances ADD CONSTRAINT hrms_grievances_disposed_chk
    CHECK ((status = 'disposed') = (disposition IS NOT NULL AND disposal_remarks IS NOT NULL AND disposed_at IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_hrms_grievances_case_no
  ON employee.hrms_grievances (tenant_id, case_no);
CREATE INDEX IF NOT EXISTS ix_hrms_grievances_tenant_status
  ON employee.hrms_grievances (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_hrms_grievances_employee
  ON employee.hrms_grievances (tenant_id, employee_id);

CREATE TABLE IF NOT EXISTS employee.hrms_grievance_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  grievance_id  uuid        NOT NULL,
  action        varchar(16) NOT NULL,
  from_status   varchar(16),
  to_status     varchar(16) NOT NULL,
  actor_id      uuid        NOT NULL,
  assigned_to   uuid,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE employee.hrms_grievance_events ADD CONSTRAINT hrms_grievance_events_action_chk
    CHECK (action IN ('register','assign','dispose'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_hrms_grievance_events_grievance
  ON employee.hrms_grievance_events (tenant_id, grievance_id, created_at);

CREATE TABLE IF NOT EXISTS employee.hrms_grievance_seq (
  tenant_id  uuid    NOT NULL,
  year       integer NOT NULL,
  next_val   integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, year)
);

ALTER TABLE employee.hrms_grievances ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_grievances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_grievances;
CREATE POLICY tenant_isolation_policy ON employee.hrms_grievances
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

ALTER TABLE employee.hrms_grievance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_grievance_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_grievance_events;
CREATE POLICY tenant_isolation_policy ON employee.hrms_grievance_events
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

ALTER TABLE employee.hrms_grievance_seq ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_grievance_seq FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_grievance_seq;
CREATE POLICY tenant_isolation_policy ON employee.hrms_grievance_seq
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());
