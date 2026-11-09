-- Migration 0050 (workflow-service)

-- B23b-wf: let workflow instances / tasks carry the two further refTypes that publishers already send.
--
--  * meeting_decision -- meeting-service/decision/consumer.ts raises workflow.instance.create (definitionCode
--    meeting_financial_countersignature) for a financial decision at/above the GFR counter-signature threshold.
--    UAT sign-off seeding (Sundarpur Municipal Corporation, 2026-11-09) dead-lettered 3 such commands with
--    "violates check constraint instances_ref_type_check". (The seeding notes call it
--    meeting_decision_financial; the envelope in workflow.dead_letters shows the actual value is meeting_decision.)
--  * employee -- hrms-service/recruitment/consumer.ts raises employee_onboarding with refType employee;
--    the same CHECK refused it.
--
-- Widening only: every row valid under the 0048 set stays valid. Idempotent: constraints dropped (IF EXISTS) and
-- re-added, NOT VALID first then validated, the same two-pass shape as 0024 / 0048.
-- Rollback (only safe while no row uses meeting_decision / employee): re-add both constraints with the 0048 set.

ALTER TABLE workflow.instances DROP CONSTRAINT IF EXISTS instances_ref_type_check;
ALTER TABLE workflow.instances
  ADD CONSTRAINT instances_ref_type_check
  CHECK (ref_type IS NULL OR ref_type IN (
    'leave_app', 'payroll_run', 'procurement_indent', 'procurement_po', 'estab_file', 'asset_disposal',
    'procurement_plan', 'procurement_po_amendment',
    'meeting_decision', 'employee'
  ))
  NOT VALID;

ALTER TABLE workflow.tasks DROP CONSTRAINT IF EXISTS tasks_ref_type_check;
ALTER TABLE workflow.tasks
  ADD CONSTRAINT tasks_ref_type_check
  CHECK (ref_type IS NULL OR ref_type IN (
    'leave_app', 'payroll_run', 'procurement_indent', 'procurement_po', 'estab_file', 'asset_disposal',
    'procurement_plan', 'procurement_po_amendment',
    'meeting_decision', 'employee'
  ))
  NOT VALID;

ALTER TABLE workflow.instances VALIDATE CONSTRAINT instances_ref_type_check;
ALTER TABLE workflow.tasks VALIDATE CONSTRAINT tasks_ref_type_check;
