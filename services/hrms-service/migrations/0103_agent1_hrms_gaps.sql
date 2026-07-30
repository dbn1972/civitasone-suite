-- 0103_agent1_hrms_gaps.sql
-- Agent 1 HRMS gap-closure tasks: 0175, 0176, 0180, 0195, 0227, 0230, 0233, 0314
-- Additive + idempotent. FORCE RLS on app.tenant_id GUC.
--
-- Rollback:
--   ALTER TABLE employee.hrms_employees DROP COLUMN IF EXISTS fitness_status;
--   ALTER TABLE employee.hrms_employees DROP COLUMN IF EXISTS functional_manager_id;
--   ALTER TABLE employee.hrms_employees DROP COLUMN IF EXISTS project_manager_id;
--   DROP TABLE IF EXISTS disciplinary.hrms_coi_declarations;
--   DROP TABLE IF EXISTS lifecycle.hrms_employee_holds;

SET lock_timeout = '5s';

-- ── 0175: fitness_status on employee ──────────────────────────────────────────
-- Medical fitness status for joining/periodic medical exam clearance.
-- Values: fit, unfit, temporary_unfit, pending, exempt
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'employee' AND table_name = 'hrms_employees' AND column_name = 'fitness_status'
  ) THEN
    ALTER TABLE employee.hrms_employees ADD COLUMN fitness_status varchar(16) DEFAULT 'pending';
  END IF;
END $$;

-- ── 0227: functional_manager_id + project_manager_id on employee ──────────────
-- Matrix org: reporting manager is existing manager_id; these are dotted-line.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'employee' AND table_name = 'hrms_employees' AND column_name = 'functional_manager_id'
  ) THEN
    ALTER TABLE employee.hrms_employees ADD COLUMN functional_manager_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'employee' AND table_name = 'hrms_employees' AND column_name = 'project_manager_id'
  ) THEN
    ALTER TABLE employee.hrms_employees ADD COLUMN project_manager_id uuid;
  END IF;
END $$;

-- ── 0176: COI / confidentiality declarations (disciplinary module) ────────────
CREATE TABLE IF NOT EXISTS disciplinary.hrms_coi_declarations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  employee_id     uuid NOT NULL,
  declaration_type varchar(32) NOT NULL,
  declaration_date date NOT NULL,
  details         text NOT NULL,
  status          varchar(16) NOT NULL DEFAULT 'active',
  acknowledged_at timestamptz,
  revoked_at      timestamptz,
  revoke_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_coi_decl_type_check CHECK (declaration_type IN ('coi','confidentiality','property','gift','outside_employment')),
  CONSTRAINT hrms_coi_decl_status_check CHECK (status IN ('active','revoked','expired','superseded'))
);
CREATE INDEX IF NOT EXISTS hrms_coi_decl_emp_idx ON disciplinary.hrms_coi_declarations (tenant_id, employee_id, declaration_type);

-- ── 0314: Employee hold/release with approval status ──────────────────────────
CREATE TABLE IF NOT EXISTS lifecycle.hrms_employee_holds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  employee_id     uuid NOT NULL,
  hold_type       varchar(32) NOT NULL,
  reason          text NOT NULL,
  status          varchar(16) NOT NULL DEFAULT 'pending',
  requested_by    uuid NOT NULL,
  approved_by     uuid,
  approved_at     timestamptz,
  released_by     uuid,
  released_at     timestamptz,
  release_reason  text,
  effective_from  date NOT NULL,
  effective_to    date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_hold_type_check CHECK (hold_type IN ('salary','increment','promotion','transfer','all')),
  CONSTRAINT hrms_hold_status_check CHECK (status IN ('pending','approved','active','released','rejected'))
);
CREATE INDEX IF NOT EXISTS hrms_hold_emp_idx ON lifecycle.hrms_employee_holds (tenant_id, employee_id, status);
CREATE INDEX IF NOT EXISTS hrms_hold_active_idx ON lifecycle.hrms_employee_holds (tenant_id, status) WHERE status IN ('approved','active');

-- ── RLS for new tables ────────────────────────────────────────────────────────
DO $$ DECLARE t text; s text; BEGIN
  FOR t, s IN VALUES
    ('hrms_coi_declarations','disciplinary'),
    ('hrms_employee_holds','lifecycle')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', s, t);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', s, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I.%I', t, s, t);
    EXECUTE format('CREATE POLICY %I_tenant ON %I.%I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t, s, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.%I TO hrms_svc', s, t);
  END LOOP;
END $$;
