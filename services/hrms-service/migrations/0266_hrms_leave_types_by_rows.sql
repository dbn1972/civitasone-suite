-- 0266_hrms_leave_types_by_rows.sql
--
-- S8-G3: organisation-defined leave types and rules by employee type.
-- (docs: ~/orch-logs/segments/section8-design.md section 4.)
--
-- Leave types become DATA: a tenant can define its own code, deactivate a type, and the
-- rules engine can resolve a rule from the tenant's rows without a hard-coded catalogue
-- entry. Everything here is ADDITIVE and defaults to "exactly as before":
--   * is_active defaults true, allocation status defaults 'active', allowed_in_probation
--     is back-filled so the old "CL only in probation" behaviour is preserved.
--   * the new resolver is behind a per-tenant switch (leave.hrms_leave_tenant_config.
--     custom_leave_rules_enabled, default false); a tenant that never turns it on is
--     served by the unchanged engine path.
--
-- Rollback (nothing else depends on these):
--   DROP TABLE IF EXISTS leave.hrms_leave_type_changes;
--   ALTER TABLE leave.hrms_leave_tenant_config DROP COLUMN IF EXISTS custom_leave_rules_enabled;
--   ALTER TABLE leave.hrms_leave_allocs DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS ended_on,
--     DROP COLUMN IF EXISTS ended_reason, DROP COLUMN IF EXISTS ended_by;
--   ALTER TABLE leave.hrms_leave_policy_rules DROP COLUMN IF EXISTS allowed_in_probation;
--   ALTER TABLE leave.hrms_leave_types DROP COLUMN IF EXISTS is_active, DROP COLUMN IF EXISTS system_code,
--     DROP COLUMN IF EXISTS category, DROP COLUMN IF EXISTS gender_restriction, DROP COLUMN IF EXISTS description;

SET lock_timeout = '5s';

-- ── leave types ─────────────────────────────────────────────────────────────
ALTER TABLE leave.hrms_leave_types ADD COLUMN IF NOT EXISTS is_active          boolean     NOT NULL DEFAULT true;
-- Links a tenant type to a built-in behaviour of the rules engine (CL half-day, ML/PL/CCL gender
-- checks, ...). NULL = a purely tenant-defined type that is resolved from the tenant's rule rows.
ALTER TABLE leave.hrms_leave_types ADD COLUMN IF NOT EXISTS system_code        varchar(8);
ALTER TABLE leave.hrms_leave_types ADD COLUMN IF NOT EXISTS category           varchar(16);
ALTER TABLE leave.hrms_leave_types ADD COLUMN IF NOT EXISTS gender_restriction varchar(8);
ALTER TABLE leave.hrms_leave_types ADD COLUMN IF NOT EXISTS description        text;

ALTER TABLE leave.hrms_leave_types DROP CONSTRAINT IF EXISTS hrms_leave_types_category_chk;
ALTER TABLE leave.hrms_leave_types ADD CONSTRAINT hrms_leave_types_category_chk
  CHECK (category IS NULL OR category IN ('paid', 'unpaid', 'statutory', 'comp_off'));
ALTER TABLE leave.hrms_leave_types DROP CONSTRAINT IF EXISTS hrms_leave_types_gender_chk;
ALTER TABLE leave.hrms_leave_types ADD CONSTRAINT hrms_leave_types_gender_chk
  CHECK (gender_restriction IS NULL OR gender_restriction IN ('male', 'female'));

-- Back-fill: a type whose code is one of the engine's built-in catalogue codes keeps behaving as
-- that built-in (this is what the engine did before, keyed on code). Idempotent: only NULL rows.
UPDATE leave.hrms_leave_types
   SET system_code = upper(code)
 WHERE system_code IS NULL
   AND upper(code) IN ('CL', 'EL', 'HPL', 'COML', 'ML', 'PL', 'CCL', 'SL', 'SCL', 'CO');

-- ── policy rules (per leave type x employee type) ───────────────────────────
-- Probation used to be a hard-coded "only CL" check. It becomes a rule property.
ALTER TABLE leave.hrms_leave_policy_rules ADD COLUMN IF NOT EXISTS allowed_in_probation boolean NOT NULL DEFAULT false;
UPDATE leave.hrms_leave_policy_rules r
   SET allowed_in_probation = true
  FROM leave.hrms_leave_types t
 WHERE t.id = r.leave_type_id AND t.tenant_id = r.tenant_id AND upper(t.code) = 'CL'
   AND r.allowed_in_probation = false;

-- ── allocations: soft end instead of delete ─────────────────────────────────
ALTER TABLE leave.hrms_leave_allocs ADD COLUMN IF NOT EXISTS status       varchar(12) NOT NULL DEFAULT 'active';
ALTER TABLE leave.hrms_leave_allocs ADD COLUMN IF NOT EXISTS ended_on     date;
ALTER TABLE leave.hrms_leave_allocs ADD COLUMN IF NOT EXISTS ended_reason text;
ALTER TABLE leave.hrms_leave_allocs ADD COLUMN IF NOT EXISTS ended_by     uuid;
ALTER TABLE leave.hrms_leave_allocs DROP CONSTRAINT IF EXISTS hrms_leave_allocs_status_chk;
ALTER TABLE leave.hrms_leave_allocs ADD CONSTRAINT hrms_leave_allocs_status_chk CHECK (status IN ('active', 'ended'));

-- ── per-tenant switch for the row-based resolver (default OFF) ──────────────
ALTER TABLE leave.hrms_leave_tenant_config ADD COLUMN IF NOT EXISTS custom_leave_rules_enabled boolean NOT NULL DEFAULT false;

-- ── maker-checker requests to change a leave type (deactivate / reactivate) ─
CREATE TABLE IF NOT EXISTS leave.hrms_leave_type_changes (
  id             uuid        PRIMARY KEY,
  tenant_id      uuid        NOT NULL,
  leave_type_id  uuid        NOT NULL,
  -- set for the single-allocation actions ('end_allocation' / 'reinstate_allocation')
  alloc_id       uuid,
  action         varchar(24) NOT NULL CHECK (action IN ('deactivate', 'end_allocation', 'reinstate_allocation')),
  status         varchar(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reason         text        NOT NULL,
  -- snapshot of what the request would touch when it was raised (the checker sees it; the
  -- consumer re-counts at apply time, so this is informational, never trusted for the write).
  impact         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  requested_by   uuid        NOT NULL,
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  applied_summary jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1
);

-- One open request per target (the allocation for allocation actions, else the leave type): a second one
-- while one is pending is a no-op conflict.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_leave_type_changes_one_pending
  ON leave.hrms_leave_type_changes (tenant_id, COALESCE(alloc_id, leave_type_id)) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS hrms_leave_type_changes_tenant_status_idx
  ON leave.hrms_leave_type_changes (tenant_id, status, created_at DESC);

ALTER TABLE leave.hrms_leave_type_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_type_changes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_leave_type_changes;
CREATE POLICY tenant_isolation_policy ON leave.hrms_leave_type_changes
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- Helps the "open applications on this type" and "live allocations on this type" counts.
CREATE INDEX IF NOT EXISTS hrms_leave_allocs_type_status_idx
  ON leave.hrms_leave_allocs (tenant_id, leave_type_id, status);
CREATE INDEX IF NOT EXISTS hrms_leave_apps_type_status_idx
  ON leave.hrms_leave_apps (tenant_id, leave_type_id, status);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_svc') THEN
    GRANT SELECT, INSERT, UPDATE ON leave.hrms_leave_type_changes TO hrms_svc;
  END IF;
END $$;
