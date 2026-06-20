-- estab-service initial migration
-- Applied with estab_svc role on civitas_estab.
-- L2 schemas: files, committee, assets, facilities, legal
-- Outbox/inbox schemas pre-created by DB bootstrap.

CREATE SCHEMA IF NOT EXISTS files;
CREATE SCHEMA IF NOT EXISTS committee;
CREATE SCHEMA IF NOT EXISTS assets;
CREATE SCHEMA IF NOT EXISTS facilities;
CREATE SCHEMA IF NOT EXISTS legal;

-- ── files module ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS files.estab_files (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  file_no          text        NOT NULL,
  subject          text        NOT NULL,
  dept             text        NOT NULL,
  priority         varchar(16) NOT NULL DEFAULT 'normal',   -- normal|urgent|immediate
  classification   varchar(16) NOT NULL DEFAULT 'public'
                   CHECK (classification IN ('top_secret','secret','confidential','public')),
  current_with     uuid        NOT NULL,                    -- identity_users:UUID (opaque)
  status           varchar(16) NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','active','closed','archived')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, file_no)
);

CREATE TABLE IF NOT EXISTS files.estab_notings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  file_id          uuid        NOT NULL,
  seq              integer     NOT NULL,
  officer_id       uuid        NOT NULL,                    -- identity_users:UUID (opaque)
  body             text        NOT NULL,
  action           varchar(64),
  e_signed         boolean     NOT NULL DEFAULT false,
  signed_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS files.estab_dispatch (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  dispatch_no      text        NOT NULL,
  file_id          uuid,                                    -- optional link to file
  to_address       text        NOT NULL,
  mode             varchar(32) NOT NULL DEFAULT 'email',    -- email|post|courier|fax|hand
  subject          text        NOT NULL,
  dispatched_at    timestamptz,
  status           varchar(24) NOT NULL DEFAULT 'pending',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, dispatch_no)
);

CREATE TABLE IF NOT EXISTS files.estab_inward (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  dak_no           text        NOT NULL,
  from_address     text        NOT NULL,
  subject          text        NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  assigned_to      uuid,                                    -- identity_users:UUID (opaque)
  file_ref         text,                                    -- estab_files:UUID (opaque)
  status           varchar(24) NOT NULL DEFAULT 'received',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, dak_no)
);

-- ── committee module ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS committee.estab_committees (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  name             text        NOT NULL,
  purpose          text,
  chair_ref        uuid        NOT NULL,                    -- identity_users:UUID (opaque)
  status           varchar(24) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS committee.estab_meetings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  committee_id     uuid        NOT NULL,
  title            text        NOT NULL,
  when_at          timestamptz NOT NULL,
  venue            text,
  minutes_url      text,
  status           varchar(24) NOT NULL DEFAULT 'scheduled', -- scheduled|held|cancelled
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS committee.estab_resolutions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  meeting_id       uuid        NOT NULL,
  seq              integer     NOT NULL,
  body             text        NOT NULL,
  action_owner     uuid,                                    -- identity_users:UUID (opaque)
  due_date         date,
  status           varchar(24) NOT NULL DEFAULT 'pending',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS committee.estab_attendees (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  meeting_id       uuid        NOT NULL,
  member_ref       uuid        NOT NULL,                    -- identity_users:UUID (opaque)
  role             varchar(32) NOT NULL DEFAULT 'member',   -- chair|member|secretary|observer
  attended         boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (meeting_id, member_ref)
);

-- ── assets module ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS assets.estab_vehicles (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  reg_no           text        NOT NULL,
  make_model       text        NOT NULL,
  fuel_type        varchar(16) NOT NULL DEFAULT 'petrol',   -- petrol|diesel|cng|ev
  allocated_to     uuid,                                    -- identity_users:UUID (opaque)
  odometer_km      integer     NOT NULL DEFAULT 0,
  status           varchar(24) NOT NULL DEFAULT 'available', -- available|in_use|maintenance|retired
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, reg_no)
);

CREATE TABLE IF NOT EXISTS assets.estab_drivers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  employee_ref     uuid        NOT NULL,                    -- hr_employees:UUID (opaque)
  licence_no       text        NOT NULL,
  licence_expiry   date        NOT NULL,
  status           varchar(24) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, employee_ref)
);

CREATE TABLE IF NOT EXISTS assets.estab_vehicle_bookings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  vehicle_id       uuid        NOT NULL,
  requested_by     uuid        NOT NULL,                    -- identity_users:UUID (opaque)
  driver_id        uuid,
  purpose          text        NOT NULL,
  from_dt          timestamptz NOT NULL,
  to_dt            timestamptz NOT NULL,
  status           varchar(24) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','in_use','returned','cancelled')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

-- ── facilities module ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS facilities.estab_guesthouses (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  name             text        NOT NULL,
  location         text,
  contact          text,
  status           varchar(24) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS facilities.estab_rooms (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  guesthouse_id    uuid        NOT NULL,
  room_no          text        NOT NULL,
  type             varchar(32) NOT NULL DEFAULT 'standard', -- standard|suite|meeting
  capacity         integer     NOT NULL DEFAULT 1,
  status           varchar(24) NOT NULL DEFAULT 'available',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (guesthouse_id, room_no)
);

CREATE TABLE IF NOT EXISTS facilities.estab_room_bookings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  room_id          uuid        NOT NULL,
  guest_name       text        NOT NULL,
  guest_ref        uuid,                                    -- identity_users:UUID (opaque)
  check_in         timestamptz NOT NULL,
  check_out        timestamptz NOT NULL,
  sponsor_dept     text,
  charges_minor    bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  status           varchar(24) NOT NULL DEFAULT 'booked',   -- booked|checked_in|checked_out|cancelled
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS facilities.estab_library_books (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  accession_no     text        NOT NULL,
  title            text        NOT NULL,
  author           text,
  isbn             text,
  category         text,
  copies_total     integer     NOT NULL DEFAULT 1,
  copies_available integer     NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, accession_no)
);

CREATE TABLE IF NOT EXISTS facilities.estab_issues (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  book_id          uuid        NOT NULL,
  employee_ref     uuid        NOT NULL,                    -- hr_employees:UUID (opaque)
  issued_at        timestamptz NOT NULL DEFAULT now(),
  due_at           timestamptz NOT NULL,
  returned_at      timestamptz,
  status           varchar(24) NOT NULL DEFAULT 'issued',   -- issued|returned|overdue
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

-- ── legal module ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS legal.estab_court_cases (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  case_no          text        NOT NULL,
  title            text        NOT NULL,
  court            text        NOT NULL,
  subject          text,
  petitioner       text,
  counsel_ref      text,                                    -- opaque ref
  next_hearing     date,
  status           varchar(24) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','disposed','appealed','stayed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, case_no)
);

CREATE TABLE IF NOT EXISTS legal.estab_case_dates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  case_id          uuid        NOT NULL,
  hearing_date     date        NOT NULL,
  purpose          text,
  outcome          text,
  next_date        date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS legal.estab_rti_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  rti_no           text        NOT NULL,
  applicant        text        NOT NULL,
  subject          text        NOT NULL,
  cpio_ref         uuid        NOT NULL,                    -- identity_users:UUID (opaque)
  deadline         date        NOT NULL,                    -- created_at::date + 30
  response_url     text,
  responded_at     timestamptz,
  status           varchar(24) NOT NULL DEFAULT 'pending',  -- pending|responded|appealed|overdue
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, rti_no)
);

-- ── indexes ───────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_estab_files_tenant_status    ON files.estab_files(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_estab_files_current_with     ON files.estab_files(current_with);
CREATE INDEX IF NOT EXISTS idx_estab_notings_file           ON files.estab_notings(file_id, seq);
CREATE INDEX IF NOT EXISTS idx_estab_dispatch_tenant        ON files.estab_dispatch(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_estab_inward_tenant          ON files.estab_inward(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_estab_meetings_committee     ON committee.estab_meetings(committee_id);
CREATE INDEX IF NOT EXISTS idx_estab_resolutions_meeting    ON committee.estab_resolutions(meeting_id);
CREATE INDEX IF NOT EXISTS idx_estab_attendees_meeting      ON committee.estab_attendees(meeting_id);
CREATE INDEX IF NOT EXISTS idx_estab_vbookings_vehicle      ON assets.estab_vehicle_bookings(vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_estab_rbookings_room         ON facilities.estab_room_bookings(room_id, status);
CREATE INDEX IF NOT EXISTS idx_estab_issues_employee        ON facilities.estab_issues(employee_ref, status);
CREATE INDEX IF NOT EXISTS idx_estab_rti_tenant_status      ON legal.estab_rti_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_estab_cases_tenant_status    ON legal.estab_court_cases(tenant_id, status);

-- ── outbox (write-path durability) ───────────────────────────────

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid         NOT NULL,
  actor_id       uuid         NOT NULL,
  correlation_id varchar(64)  NOT NULL,
  payload        jsonb        NOT NULL,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  published_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON _outbox.messages(created_at) WHERE published_at IS NULL;

-- ── inbox (consumer idempotency) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid        PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
