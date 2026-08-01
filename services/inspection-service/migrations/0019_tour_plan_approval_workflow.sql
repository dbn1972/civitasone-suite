-- 0019_tour_plan_approval_workflow.sql
--
-- Purpose: add the SVC-109 tour-plan approval workflow columns that
-- COMMANDS.tourPlanSubmit / COMMANDS.tourPlanApprove need in order to persist a
-- status transition.
--
-- WHY THIS FILE EXISTS
-- Two commands (inspection.tour_plan.submit, inspection.tour_plan.approve) were
-- published by routes.ts -> commands.ts and returned 202, but NO consumer ever
-- subscribed to them, so a submitted/approved tour plan never actually changed
-- state — a live black-hole facade. Wiring the consumer (this change also adds
-- the subscriptions in modules/assignment/consumer.ts) requires somewhere to
-- persist the transition, but assignment.tour_plans had no `status` column at
-- all — every tour plan was implicitly stateless.
--
-- Domain validation for the state machine already existed in
-- src/modules/assignment/domain.ts (TOUR_PLAN_STATES, TOUR_PLAN_TRANSITIONS,
-- assertValidTourPlanTransition, assertMakerCheckerApproval) but had no schema
-- to read from or write to. This migration adds that schema.
--
-- Lifecycle (per domain.ts TOUR_PLAN_TRANSITIONS):
--   draft -> submitted -> approved | rejected
--   rejected -> draft
-- Only submit and approve have a published command today; 'rejected' is
-- reachable only by future work and is not written by this change.
--
-- submitted_by / approved_by capture the maker and the checker so the consumer
-- can enforce approver != submitter (maker-checker) on every approve, including
-- redeliveries.
--
-- Rollback (ADDITIVE, so safe to drop individually if ever needed):
--   DROP INDEX IF EXISTS assignment.idx_tour_plans_tenant_status;
--   ALTER TABLE assignment.tour_plans DROP COLUMN IF EXISTS approved_at;
--   ALTER TABLE assignment.tour_plans DROP COLUMN IF EXISTS approved_by;
--   ALTER TABLE assignment.tour_plans DROP COLUMN IF EXISTS submitted_at;
--   ALTER TABLE assignment.tour_plans DROP COLUMN IF EXISTS submitted_by;
--   ALTER TABLE assignment.tour_plans DROP COLUMN IF EXISTS status;
--
-- Affected services: inspection-service only (own database, no cross-service
-- tables). Additive and idempotent.

SET lock_timeout = '5s';

ALTER TABLE assignment.tour_plans
  ADD COLUMN IF NOT EXISTS status varchar(24) NOT NULL DEFAULT 'draft';

ALTER TABLE assignment.tour_plans
  ADD COLUMN IF NOT EXISTS submitted_by uuid;

ALTER TABLE assignment.tour_plans
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

ALTER TABLE assignment.tour_plans
  ADD COLUMN IF NOT EXISTS approved_by uuid;

ALTER TABLE assignment.tour_plans
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Supports status-filtered lookups (e.g. "all submitted plans awaiting approval
-- for a tenant") and the guarded UPDATE ... WHERE tenant_id = ? AND status = ?
-- the consumer issues on every submit/approve.
CREATE INDEX IF NOT EXISTS idx_tour_plans_tenant_status
  ON assignment.tour_plans(tenant_id, status);
