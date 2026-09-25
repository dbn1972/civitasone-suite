-- 0150: hrms.development_plans -- backing table for the Individual
-- Development Plan timeline on /hr/goals.
--
-- services/hrms-service/src/modules/gap-features/performance-dev-routes.ts
-- has shipped POST/GET/PATCH /v1/hrms/development-plans since it was added,
-- but no migration ever created hrms.development_plans -- every call failed
-- with `relation "hrms.development_plans" does not exist`. The frontend
-- (hr/goals/page.tsx) silently swallowed that failure: it read the loader's
-- `data` (which defaults to `[]` on any error, per fetchJson's contract) but
-- never checked the loader's own `source`, so a real backend error rendered
-- DevelopmentPlanTimeline with zero activities -- pixel-identical to a
-- tenant that has genuinely never planned any. See the same change's fix to
-- hr/goals/page.tsx for the honest-error half of this bug.
--
-- Column set matches performance-dev-routes.ts's INSERT/SELECT/PATCH exactly
-- (id, tenant_id, employee_id, title, description, type, planned_date,
-- duration_days, skill_targeted, priority, status, created_by, created_at
-- on create; status/completed_at/notes/updated_at on the PATCH).
CREATE TABLE IF NOT EXISTS hrms.development_plans (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  employee_id    UUID NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  type           TEXT NOT NULL DEFAULT 'other'
    CHECK (type IN ('training','project','mentoring','self_study','certification','job_rotation','other')),
  planned_date   DATE NOT NULL,
  duration_days  INT,
  skill_targeted TEXT,
  priority       TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  status         TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','deferred','cancelled')),
  completed_at   TIMESTAMPTZ,
  notes          TEXT,
  created_by     UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_development_plans_tenant_employee
  ON hrms.development_plans (tenant_id, employee_id, planned_date);

-- Match the sibling hrms.goals table (same migration family, 0116) --
-- forced RLS + tenant_isolation_policy is this schema's established
-- convention, not optional hardening; a table added without it would be the
-- exact "RLS silent-empty" class of bug this codebase's audits have
-- repeatedly found and fixed elsewhere (e.g. social/routes.ts's
-- withRawTenantGuc header comment, migration 0142_perf016_tenant_indexes).
ALTER TABLE hrms.development_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.development_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.development_plans;
CREATE POLICY tenant_isolation_policy ON hrms.development_plans
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());
