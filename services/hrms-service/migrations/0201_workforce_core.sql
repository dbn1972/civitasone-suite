-- 0201_workforce_core.sql  (SmartTransfer OS — ST-M01-07, Workforce Core schema)
--
-- Spec §4 (Universal domain model: Sanctioned Position, Occupancy, Cadre,
-- Posting History / Service Tenure; four separate placement kinds).
-- Decisions: D-ST-01 (Workforce Core owns the canonical Post + effective-dated
-- Occupancy), D-ST-02 (office = HRMS department tree, by id), D-ST-03 (cadre
-- master + employee-cadre link + cadre-wise seniority owned by Workforce Core),
-- D-ST-23 (Workforce Core is a liftable module profile of hrms-service — its
-- NEW tables live in their OWN schema `workforce_core` so they can be extracted
-- to a package/service later).
--
-- This migration adds SCHEMA ONLY (plus a tenure read function and the posting
-- ledger that is "live behind a flag" per M01 exit criterion 2). It writes no
-- rows and emits no events. The single HRMS `applyPosting` write path and the
-- `hrms.posting.*` events are ST-M01-09; the backfill is ST-M01-08. Columns
-- that depend on PROPOSED decisions (holds D-ST-16; payroll/DDO D-ST-13/14) are
-- deliberately NOT added here.
--
-- Tables (all tenant_id + FORCE RLS + leading tenant_id index + version + audit):
--   • cadre            — cadre master (hierarchical via parent_cadre_id), D-ST-03.
--   • employee_cadre   — employee→cadre link + cadre-wise seniority, D-ST-03.
--   • post             — sanctioned position: office_id (= HRMS department, by
--                        id, D-ST-02), designation_id, cadre_id, grade_pay_level,
--                        reservation_tag, attributes jsonb, status.
--   • post_occupancy   — effective-dated [effective_from, effective_to) occupancy
--                        with a charge_type. A DB EXCLUDE USING gist constraint
--                        enforces (a) at most ONE substantive holder per post at
--                        any instant and (b) an employee is substantively in at
--                        most ONE post at any instant (spec §4 "substantive
--                        appointment"). Mirrors prior-art uniq_postings_substantive
--                        (location-service/migrations/0005a_org_model.sql:159-161)
--                        but generalised to effective-dated ranges.
--   • posting_ledger   — append-only effective-dated posting history; tenure is
--                        derivable from it (workforce_core.service_tenure_days()
--                        and the station-tenure view below). This is the
--                        "live behind a flag" ledger (M01 exit criterion 2); the
--                        flag that later PRs read is WORKFORCE_CORE_LEDGER_ENABLED
--                        (src/modules/workforce-core/config.ts, default off).
--
-- RLS pattern mirrors 0062_manpower_planning.sql: a schema-local
-- current_tenant_id() reading the app.tenant_id GUC fail-closed, then
-- ENABLE + FORCE ROW LEVEL SECURITY and a tenant_isolation policy per table
-- (USING + WITH CHECK so a cross-tenant write is rejected too). No cross-service
-- foreign keys: office_id / designation_id / employee_id reference other
-- domains BY ID only (CLAUDE.md §3.13, D-ST-10).
--
-- Overlap model: post_occupancy uses a half-open daterange
-- [effective_from, COALESCE(effective_to,'infinity')). Two postings that share
-- a boundary date (one ends the day the next begins) therefore do NOT overlap —
-- adjacent ranges are allowed; only a genuine temporal overlap is rejected.
-- Requires btree_gist for the equality members of the GiST exclusion.
--
-- Additive + idempotent (CREATE SCHEMA/TABLE/INDEX IF NOT EXISTS; the EXCLUDE
-- constraints and policies are guarded by catalog checks). Money/marks n/a.
--
-- Rollback:
--   DROP SCHEMA IF EXISTS workforce_core CASCADE;

SET lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS workforce_core;

-- ── Cadre master (D-ST-03) ──────────────────────────────────────────────────
-- Hierarchical via parent_cadre_id (self-reference). external_code supports the
-- Mode B import mapping (D-ST-23). Status abolished keeps history, not deletes.
CREATE TABLE IF NOT EXISTS workforce_core.cadre (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  parent_cadre_id  uuid REFERENCES workforce_core.cadre(id) ON DELETE RESTRICT,
  code             varchar(64) NOT NULL,
  name             varchar(200) NOT NULL,
  external_code    varchar(128),               -- Mode B external-HRMS mapping
  status           varchar(16) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_by       uuid,
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT cadre_status_check CHECK (status IN ('active','merged','abolished')),
  CONSTRAINT cadre_unique_code  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS cadre_tenant_idx        ON workforce_core.cadre (tenant_id, status);
CREATE INDEX IF NOT EXISTS cadre_tenant_parent_idx ON workforce_core.cadre (tenant_id, parent_cadre_id);

-- ── Employee→cadre link + cadre-wise seniority (D-ST-03) ────────────────────
-- One active cadre membership per employee (partial unique below); seniority is
-- expressed as both a seniority_date (join/allotment date into the cadre) and an
-- optional explicit seniority_rank within the cadre. employee_id references the
-- HRMS employee BY ID (no cross-service FK).
CREATE TABLE IF NOT EXISTS workforce_core.employee_cadre (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  employee_id      uuid NOT NULL,              -- employee.hrms_employees.id, by id
  cadre_id         uuid NOT NULL REFERENCES workforce_core.cadre(id) ON DELETE RESTRICT,
  seniority_date   date NOT NULL,              -- date of entry into the cadre
  seniority_rank   integer,                    -- optional explicit rank within cadre
  status           varchar(16) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_by       uuid,
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT employee_cadre_status_check CHECK (status IN ('active','superseded'))
);
CREATE INDEX IF NOT EXISTS employee_cadre_tenant_idx     ON workforce_core.employee_cadre (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS employee_cadre_cadre_rank_idx ON workforce_core.employee_cadre (tenant_id, cadre_id, seniority_date);
-- At most one ACTIVE cadre membership per employee.
CREATE UNIQUE INDEX IF NOT EXISTS employee_cadre_one_active
  ON workforce_core.employee_cadre (tenant_id, employee_id)
  WHERE status = 'active';
-- Cadre-wise seniority rank is unique within an (active) cadre when assigned.
CREATE UNIQUE INDEX IF NOT EXISTS employee_cadre_rank_unique
  ON workforce_core.employee_cadre (tenant_id, cadre_id, seniority_rank)
  WHERE status = 'active' AND seniority_rank IS NOT NULL;

-- ── Sanctioned Post (D-ST-01, D-ST-02) ──────────────────────────────────────
-- office_id = a node of the HRMS department/office tree (D-ST-02), referenced by
-- id. designation_id, cadre_id classify the post. attributes jsonb holds
-- position-requirement attributes (qualification/specialisation flags) that do
-- NOT warrant their own column yet; sensitive/eligibility attributes that depend
-- on PROPOSED decisions are NOT stored here. status drives vacancy derivation.
CREATE TABLE IF NOT EXISTS workforce_core.post (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  post_no          varchar(64) NOT NULL,        -- sanctioned-post reference number
  office_id        uuid NOT NULL,               -- HRMS department/office node, by id (D-ST-02)
  designation_id   uuid,                        -- hrms_designations.id, by id
  cadre_id         uuid REFERENCES workforce_core.cadre(id) ON DELETE RESTRICT,
  grade_pay_level  varchar(32),
  reservation_tag  varchar(16),                 -- SC/ST/OBC/EWS/UR/PwD roster tag
  attributes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           varchar(16) NOT NULL DEFAULT 'sanctioned',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_by       uuid,
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT post_status_check CHECK (status IN ('sanctioned','frozen','abolished')),
  CONSTRAINT post_unique_no    UNIQUE (tenant_id, post_no)
);
CREATE INDEX IF NOT EXISTS post_tenant_idx        ON workforce_core.post (tenant_id, status);
CREATE INDEX IF NOT EXISTS post_tenant_office_idx ON workforce_core.post (tenant_id, office_id);
CREATE INDEX IF NOT EXISTS post_tenant_cadre_idx  ON workforce_core.post (tenant_id, cadre_id);

-- ── Post Occupancy (D-ST-01) — effective-dated, one substantive holder ──────
-- charge_type separates the placement kinds (spec §4):
--   substantive  = permanent appointment (the one-holder invariant applies)
--   acting / additional / in_charge = temporary attachments (may coexist)
CREATE TABLE IF NOT EXISTS workforce_core.post_occupancy (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  post_id          uuid NOT NULL REFERENCES workforce_core.post(id) ON DELETE RESTRICT,
  employee_id      uuid NOT NULL,               -- employee.hrms_employees.id, by id
  charge_type      varchar(16) NOT NULL DEFAULT 'substantive',
  effective_from   date NOT NULL,
  effective_to     date,                        -- NULL = open-ended
  order_ref        varchar(128),                -- movement order reference, by id
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_by       uuid,
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT post_occupancy_charge_check CHECK (charge_type IN ('substantive','acting','additional','in_charge')),
  -- Half-open [from, to): an equal from/to is an EMPTY range, and an empty range
  -- bypasses the EXCLUDE constraints below, so require to > from strictly.
  CONSTRAINT post_occupancy_dates_check  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
-- Re-assert on databases where an earlier revision of this file created the
-- table with the looser (>=) check. Idempotent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'post_occupancy_dates_check'
      AND conrelid = 'workforce_core.post_occupancy'::regclass
      AND pg_get_constraintdef(oid) LIKE '%>=%'
  ) THEN
    ALTER TABLE workforce_core.post_occupancy DROP CONSTRAINT post_occupancy_dates_check;
    ALTER TABLE workforce_core.post_occupancy
      ADD CONSTRAINT post_occupancy_dates_check
      CHECK (effective_to IS NULL OR effective_to > effective_from);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS post_occupancy_tenant_idx      ON workforce_core.post_occupancy (tenant_id, post_id);
CREATE INDEX IF NOT EXISTS post_occupancy_tenant_emp_idx  ON workforce_core.post_occupancy (tenant_id, employee_id);

-- (a) At most ONE substantive holder per post at any instant: no two substantive
--     occupancy rows for the same (tenant, post) may have overlapping date
--     ranges. Half-open daterange means adjacent ranges (one ends the day the
--     next begins) are allowed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'post_occupancy_one_substantive_per_post'
      AND conrelid = 'workforce_core.post_occupancy'::regclass
  ) THEN
    ALTER TABLE workforce_core.post_occupancy
      ADD CONSTRAINT post_occupancy_one_substantive_per_post
      EXCLUDE USING gist (
        tenant_id WITH =,
        post_id WITH =,
        daterange(effective_from, effective_to, '[)') WITH &&
      ) WHERE (charge_type = 'substantive');
  END IF;
END $$;

-- (b) An employee is substantively in at most ONE post at any instant
--     (spec §4: a substantive appointment is the employee's single permanent
--     post). Same half-open range semantics.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'post_occupancy_one_substantive_per_emp'
      AND conrelid = 'workforce_core.post_occupancy'::regclass
  ) THEN
    ALTER TABLE workforce_core.post_occupancy
      ADD CONSTRAINT post_occupancy_one_substantive_per_emp
      EXCLUDE USING gist (
        tenant_id WITH =,
        employee_id WITH =,
        daterange(effective_from, effective_to, '[)') WITH &&
      ) WHERE (charge_type = 'substantive');
  END IF;
END $$;

-- Supporting GiST index for substantive-range lookups the exclusions rely on.
CREATE INDEX IF NOT EXISTS post_occupancy_substantive_range_idx
  ON workforce_core.post_occupancy
  USING gist (tenant_id, post_id, daterange(effective_from, effective_to, '[)'))
  WHERE (charge_type = 'substantive');

-- ── Posting Ledger (D-ST-01) — append-only effective-dated history ──────────
-- One row per posting span of an employee at an office/post. Tenure is derived
-- from this ledger (functions below); nothing overwrites an employee row. This
-- is the ledger that is "live behind a flag" (M01 exit criterion 2): the schema
-- exists now; whether the applyPosting write path persists into it is gated by
-- WORKFORCE_CORE_LEDGER_ENABLED (default off), read by ST-M01-09.
CREATE TABLE IF NOT EXISTS workforce_core.posting_ledger (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  employee_id      uuid NOT NULL,               -- employee.hrms_employees.id, by id
  office_id        uuid NOT NULL,               -- HRMS department/office node, by id
  post_id          uuid REFERENCES workforce_core.post(id) ON DELETE RESTRICT,
  charge_type      varchar(16) NOT NULL DEFAULT 'substantive',
  effective_from   date NOT NULL,
  effective_to     date,                        -- NULL = current (open) posting
  order_ref        varchar(128),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT posting_ledger_charge_check CHECK (charge_type IN ('substantive','acting','additional','in_charge')),
  CONSTRAINT posting_ledger_dates_check  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS posting_ledger_tenant_idx      ON workforce_core.posting_ledger (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS posting_ledger_emp_from_idx    ON workforce_core.posting_ledger (tenant_id, employee_id, effective_from);
CREATE INDEX IF NOT EXISTS posting_ledger_tenant_office_idx ON workforce_core.posting_ledger (tenant_id, office_id);

-- ── Append-only enforcement for posting_ledger ──────────────────────────────
-- The ledger is history: rows are never deleted or rewritten. The ONLY permitted
-- mutation is closing an open span (effective_to NULL -> a date, optionally with
-- a version bump), which is how a transfer ends the previous posting. Any other
-- UPDATE, any DELETE and any TRUNCATE is rejected for every role including the
-- table owner (hrms_svc), so a REVOKE alone would not bind. Corrections are made
-- by appending a new row.
CREATE OR REPLACE FUNCTION workforce_core.posting_ledger_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.effective_to IS NULL
     AND NEW.effective_to IS NOT NULL
     AND (to_jsonb(NEW) - 'effective_to' - 'version')
         = (to_jsonb(OLD) - 'effective_to' - 'version') THEN
    RETURN NEW;  -- closing an open span
  END IF;
  RAISE EXCEPTION 'workforce_core.posting_ledger is append-only (% rejected)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS posting_ledger_append_only ON workforce_core.posting_ledger;
CREATE TRIGGER posting_ledger_append_only
  BEFORE UPDATE OR DELETE ON workforce_core.posting_ledger
  FOR EACH ROW EXECUTE FUNCTION workforce_core.posting_ledger_append_only();

DROP TRIGGER IF EXISTS posting_ledger_no_truncate ON workforce_core.posting_ledger;
CREATE TRIGGER posting_ledger_no_truncate
  BEFORE TRUNCATE ON workforce_core.posting_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION workforce_core.posting_ledger_append_only();

-- ── Tenure read model (derivable from the posting ledger) ───────────────────
-- service_tenure_days(employee, as_of): number of DISTINCT calendar days the
-- employee has been in SUBSTANTIVE postings up to and including as_of. Each
-- span covers effective_from..effective_to INCLUSIVE (open spans run to as_of);
-- spans are merged (range_agg) before counting, so a transfer where the old span
-- ends the day the new one begins, or any overlap between ledger rows, never
-- counts a day twice. SECURITY INVOKER so RLS still applies to the caller.
CREATE OR REPLACE FUNCTION workforce_core.service_tenure_days(
  p_employee_id uuid,
  p_as_of       date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(upper(r) - lower(r)), 0)::integer
  FROM unnest((
    SELECT range_agg(daterange(
             l.effective_from,
             LEAST(COALESCE(l.effective_to, p_as_of), p_as_of),
             '[]'))
    FROM workforce_core.posting_ledger l
    WHERE l.employee_id = p_employee_id
      AND l.charge_type = 'substantive'
      AND l.effective_from <= p_as_of
  )) AS r;
$$;

-- current_station_tenure_days(employee, as_of): days in the CURRENT (latest, by
-- effective_from) substantive posting as of the given date — the "tenure at
-- station" an eligibility rule typically needs.
CREATE OR REPLACE FUNCTION workforce_core.current_station_tenure_days(
  p_employee_id uuid,
  p_as_of       date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT GREATEST(
    0,
    (LEAST(COALESCE(l.effective_to, p_as_of), p_as_of) - l.effective_from) + 1
  )::integer
  FROM workforce_core.posting_ledger l
  WHERE l.employee_id = p_employee_id
    AND l.charge_type = 'substantive'
    AND l.effective_from <= p_as_of
  ORDER BY l.effective_from DESC, l.created_at DESC
  LIMIT 1;
$$;

-- A convenience view: the current (open or latest) substantive posting per
-- employee, with its running tenure in days as of today. RLS on the underlying
-- table applies through the view (security_invoker).
CREATE OR REPLACE VIEW workforce_core.v_current_posting
WITH (security_invoker = true) AS
  SELECT DISTINCT ON (l.tenant_id, l.employee_id)
    l.tenant_id,
    l.employee_id,
    l.office_id,
    l.post_id,
    l.effective_from,
    l.effective_to,
    l.order_ref,
    workforce_core.current_station_tenure_days(l.employee_id, CURRENT_DATE) AS station_tenure_days
  FROM workforce_core.posting_ledger l
  WHERE l.charge_type = 'substantive'
  ORDER BY l.tenant_id, l.employee_id, l.effective_from DESC, l.created_at DESC;

-- ── Privileges ──────────────────────────────────────────────────────────────
-- The runtime role (hrms_svc, NOBYPASSRLS) owns and connects to civitas_hrms. A
-- new schema does not inherit ALTER DEFAULT PRIVILEGES from the pre-existing
-- ones, so grant explicitly, mirroring 0062_manpower_planning.sql. hrms_svc is
-- the only non-superuser service role in this DB (there is no separate hrms
-- scanner role; the _outbox relay/purge runs as hrms_svc under FORCE RLS +
-- app.tenant_id per migration 0105), so grants target hrms_svc as the repo does.
GRANT USAGE ON SCHEMA workforce_core TO hrms_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA workforce_core TO hrms_svc;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA workforce_core TO hrms_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA workforce_core
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hrms_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA workforce_core
  GRANT EXECUTE ON FUNCTIONS TO hrms_svc;

-- ── Row-Level Security (ENABLE + FORCE, per table, same file) ───────────────
-- Fail-closed tenant GUC reader (errors if app.tenant_id is unset), matching
-- 0062_manpower_planning.sql. SECURITY DEFINER so the function can read the GUC
-- regardless of the caller.
CREATE OR REPLACE FUNCTION workforce_core.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

ALTER TABLE workforce_core.cadre          ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_core.employee_cadre ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_core.post           ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_core.post_occupancy ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_core.posting_ledger ENABLE ROW LEVEL SECURITY;

ALTER TABLE workforce_core.cadre          FORCE ROW LEVEL SECURITY;
ALTER TABLE workforce_core.employee_cadre FORCE ROW LEVEL SECURITY;
ALTER TABLE workforce_core.post           FORCE ROW LEVEL SECURITY;
ALTER TABLE workforce_core.post_occupancy FORCE ROW LEVEL SECURITY;
ALTER TABLE workforce_core.posting_ledger FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON workforce_core.cadre;
DROP POLICY IF EXISTS tenant_isolation ON workforce_core.employee_cadre;
DROP POLICY IF EXISTS tenant_isolation ON workforce_core.post;
DROP POLICY IF EXISTS tenant_isolation ON workforce_core.post_occupancy;
DROP POLICY IF EXISTS tenant_isolation ON workforce_core.posting_ledger;

CREATE POLICY tenant_isolation ON workforce_core.cadre
  USING (tenant_id = workforce_core.current_tenant_id())
  WITH CHECK (tenant_id = workforce_core.current_tenant_id());
CREATE POLICY tenant_isolation ON workforce_core.employee_cadre
  USING (tenant_id = workforce_core.current_tenant_id())
  WITH CHECK (tenant_id = workforce_core.current_tenant_id());
CREATE POLICY tenant_isolation ON workforce_core.post
  USING (tenant_id = workforce_core.current_tenant_id())
  WITH CHECK (tenant_id = workforce_core.current_tenant_id());
CREATE POLICY tenant_isolation ON workforce_core.post_occupancy
  USING (tenant_id = workforce_core.current_tenant_id())
  WITH CHECK (tenant_id = workforce_core.current_tenant_id());
CREATE POLICY tenant_isolation ON workforce_core.posting_ledger
  USING (tenant_id = workforce_core.current_tenant_id())
  WITH CHECK (tenant_id = workforce_core.current_tenant_id());
