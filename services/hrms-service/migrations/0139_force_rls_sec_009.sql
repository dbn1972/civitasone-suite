-- SEC-009: RLS ENABLE without FORCE on service-owned tables.
-- hrms_svc owns learning.training_plans/training_plan_items
-- (0108_learning_training_plans.sql); the owning role silently bypasses its
-- own tenant_isolation policy without FORCE. See
-- packages/db/src/tenant-scope.ts:20.
-- Rollback (per table): ALTER TABLE <t> NO FORCE ROW LEVEL SECURITY;
BEGIN;

ALTER TABLE learning.training_plans      FORCE ROW LEVEL SECURITY;
ALTER TABLE learning.training_plan_items FORCE ROW LEVEL SECURITY;

COMMIT;
