-- hrms-service initial migration
-- Applied with hrms_svc role on civitas_hrms.
-- L2 schemas: employee, recruitment, attendance, leave, training, lifecycle, _outbox, _inbox

CREATE SCHEMA IF NOT EXISTS employee;
CREATE SCHEMA IF NOT EXISTS recruitment;
CREATE SCHEMA IF NOT EXISTS attendance;
CREATE SCHEMA IF NOT EXISTS leave;
CREATE SCHEMA IF NOT EXISTS training;
CREATE SCHEMA IF NOT EXISTS lifecycle;
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

-- ── employee module ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee.hrms_departments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  code         text        NOT NULL,
  name         text        NOT NULL,
  parent_id    uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        NOT NULL,
  updated_by   uuid        NOT NULL,
  version      integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS employee.hrms_designations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  code         text        NOT NULL,
  name         text        NOT NULL,
  level        integer     NOT NULL DEFAULT 0,
  pay_grade    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        NOT NULL,
  updated_by   uuid        NOT NULL,
  version      integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS employee.hrms_employees (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  employee_no       text        NOT NULL,
  full_name         text        NOT NULL,
  department_id     uuid        NOT NULL,
  designation_id    uuid        NOT NULL,
  date_of_joining   date        NOT NULL,
  date_of_birth     date,
  gender            varchar(16),
  pan               varchar(16),
  aadhaar_ref       text,
  mobile            varchar(20),
  email             text,
  bank_account_no   text,
  bank_ifsc         varchar(16),
  employee_type     varchar(24) NOT NULL DEFAULT 'permanent'
    CHECK (employee_type IN ('permanent','temporary','contract','deputation')),
  status            varchar(24) NOT NULL DEFAULT 'probation'
    CHECK (status IN ('probation','confirmed','transferred','suspended','separated')),
  confirmation_date date,
  basic_minor       bigint      NOT NULL DEFAULT 0,
  currency          char(3)     NOT NULL DEFAULT 'INR',
  pay_structure_id  uuid,
  user_ref          text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_by        uuid        NOT NULL,
  version           integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, employee_no)
);

CREATE TABLE IF NOT EXISTS employee.hrms_employee_docs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  employee_id   uuid        NOT NULL,
  doc_type      varchar(64) NOT NULL,
  doc_ref       text        NOT NULL,
  storage_key   text,
  verified      boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        NOT NULL,
  updated_by    uuid        NOT NULL,
  version       integer     NOT NULL DEFAULT 1
);

-- ── recruitment module ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recruitment.hrms_job_openings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  ref_no           text        NOT NULL,
  title            text        NOT NULL,
  department_id    uuid        NOT NULL,
  designation_id   uuid,
  vacancies        integer     NOT NULL DEFAULT 1,
  description      text,
  status           varchar(24) NOT NULL DEFAULT 'open',
  posted_at        date,
  closes_at        date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, ref_no)
);

CREATE TABLE IF NOT EXISTS recruitment.hrms_applications (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  job_opening_id      uuid        NOT NULL,
  applicant_name      text        NOT NULL,
  email               text,
  mobile              varchar(20),
  resume_ref          text,
  stage               varchar(32) NOT NULL DEFAULT 'applied',
  status              varchar(24) NOT NULL DEFAULT 'active',
  applied_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_by          uuid        NOT NULL,
  version             integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS recruitment.hrms_offers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  application_id   uuid        NOT NULL,
  ctc_minor        bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  joining_date     date,
  status           varchar(24) NOT NULL DEFAULT 'draft',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

-- ── attendance module ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS attendance.hrms_shifts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  name         text        NOT NULL,
  start_time   time        NOT NULL,
  end_time     time        NOT NULL,
  grace_mins   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        NOT NULL,
  updated_by   uuid        NOT NULL,
  version      integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS attendance.hrms_shift_assignments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  employee_id   uuid        NOT NULL,
  shift_id      uuid        NOT NULL,
  effective_from date       NOT NULL,
  effective_to   date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        NOT NULL,
  updated_by    uuid        NOT NULL,
  version       integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS attendance.hrms_attendance (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  employee_id    uuid        NOT NULL,
  attendance_date date       NOT NULL,
  status         varchar(24) NOT NULL DEFAULT 'present',
  in_time        time,
  out_time       time,
  shift_id       uuid,
  late_mins      integer     NOT NULL DEFAULT 0,
  source         varchar(32) NOT NULL DEFAULT 'manual',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, employee_id, attendance_date)
);

-- ── leave module ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave.hrms_leave_types (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  code             text        NOT NULL,
  name             text        NOT NULL,
  max_days         integer     NOT NULL DEFAULT 0,
  is_encashable    boolean     NOT NULL DEFAULT false,
  carry_forward    boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS leave.hrms_leave_allocs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  employee_id      uuid        NOT NULL,
  leave_type_id    uuid        NOT NULL,
  fy               char(7)     NOT NULL,
  total_days       integer     NOT NULL DEFAULT 0,
  balance_days     integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, employee_id, leave_type_id, fy)
);

CREATE TABLE IF NOT EXISTS leave.hrms_leave_apps (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  employee_id      uuid        NOT NULL,
  leave_type_id    uuid        NOT NULL,
  alloc_id         uuid        NOT NULL,
  from_date        date        NOT NULL,
  to_date          date        NOT NULL,
  days_applied     integer     NOT NULL,
  reason           text,
  approved_by      uuid,
  status           varchar(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending','approved','rejected','cancelled')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

-- ── training module ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS training.hrms_trainings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  title            text        NOT NULL,
  venue            text,
  from_date        date        NOT NULL,
  to_date          date        NOT NULL,
  facilitator      text,
  max_participants integer     NOT NULL DEFAULT 30,
  status           varchar(24) NOT NULL DEFAULT 'planned',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS training.hrms_nominations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  training_id      uuid        NOT NULL,
  employee_id      uuid        NOT NULL,
  status           varchar(24) NOT NULL DEFAULT 'nominated',
  certificate_ref  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, training_id, employee_id)
);

-- ── lifecycle module ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lifecycle.hrms_transfers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  employee_id      uuid        NOT NULL,
  from_dept_id     uuid        NOT NULL,
  to_dept_id       uuid        NOT NULL,
  from_desig_id    uuid,
  to_desig_id      uuid,
  effective_date   date        NOT NULL,
  order_ref        text,
  status           varchar(24) NOT NULL DEFAULT 'pending',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lifecycle.hrms_promotions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  employee_id      uuid        NOT NULL,
  from_desig_id    uuid        NOT NULL,
  to_desig_id      uuid        NOT NULL,
  effective_date   date        NOT NULL,
  order_ref        text,
  new_basic_minor  bigint,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  status           varchar(24) NOT NULL DEFAULT 'pending',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lifecycle.hrms_separations (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  employee_id          uuid        NOT NULL,
  separation_type      varchar(32) NOT NULL,
  effective_date       date        NOT NULL,
  last_working_date    date,
  encashment_days      integer     NOT NULL DEFAULT 0,
  encashment_minor     bigint      NOT NULL DEFAULT 0,
  gratuity_minor       bigint      NOT NULL DEFAULT 0,
  currency             char(3)     NOT NULL DEFAULT 'INR',
  remarks              text,
  status               varchar(24) NOT NULL DEFAULT 'initiated',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        NOT NULL,
  updated_by           uuid        NOT NULL,
  version              integer     NOT NULL DEFAULT 1
);

-- ── indexes ───────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_hrms_emp_tenant        ON employee.hrms_employees(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_hrms_emp_dept          ON employee.hrms_employees(tenant_id, department_id);
CREATE INDEX IF NOT EXISTS idx_hrms_att_emp_date      ON attendance.hrms_attendance(tenant_id, employee_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_hrms_leave_app_emp     ON leave.hrms_leave_apps(tenant_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_hrms_leave_alloc_emp   ON leave.hrms_leave_allocs(tenant_id, employee_id, leave_type_id, fy);
CREATE INDEX IF NOT EXISTS idx_hrms_job_tenant_status ON recruitment.hrms_job_openings(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_hrms_apps_opening      ON recruitment.hrms_applications(tenant_id, job_opening_id);
CREATE INDEX IF NOT EXISTS idx_hrms_sep_emp           ON lifecycle.hrms_separations(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_hrms_nom_training      ON training.hrms_nominations(tenant_id, training_id);

-- ── outbox ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid         NOT NULL,
  actor_id       uuid         NOT NULL,
  correlation_id varchar(64)  NOT NULL,
  payload        jsonb        NOT NULL,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  published_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_hrms_outbox_unpublished ON _outbox.messages(created_at) WHERE published_at IS NULL;

-- ── inbox ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid        PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
