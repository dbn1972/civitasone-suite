-- B9-wf1: let workflow instances / tasks carry the two procurement refTypes
-- the 0024 closed set left out.
--
-- procurement-service raises workflow.instance.create for an annual plan
-- (planning/consumer.ts, refType procurement_plan, definitionCode
-- procurement_plan_approval) and for a PO amendment (po/amendment-consumer.ts,
-- refType procurement_po_amendment, definitionCode
-- procurement_po_amendment_approval). 0024 restricted ref_type to the six
-- types known at the time, so every such instance insert, including the R13
-- "rejected" row written when the definition is missing, failed the CHECK and
-- dead-lettered: no plan or amendment approval task could ever exist.
--
-- Widening only: every row valid under the 0024 set stays valid. Idempotent:
-- the constraints are dropped (IF EXISTS) and re-added with the wider set,
-- NOT VALID first and then validated, the same two-pass shape as 0024.
-- Rollback (only safe while no row uses procurement_plan /
-- procurement_po_amendment): drop both constraints and re-add them with the
-- 0024 six-value set.

ALTER TABLE workflow.instances DROP CONSTRAINT IF EXISTS instances_ref_type_check;
ALTER TABLE workflow.instances
  ADD CONSTRAINT instances_ref_type_check
  CHECK (ref_type IS NULL OR ref_type IN (
    'leave_app', 'payroll_run', 'procurement_indent', 'procurement_po', 'estab_file', 'asset_disposal',
    'procurement_plan', 'procurement_po_amendment'
  ))
  NOT VALID;

ALTER TABLE workflow.tasks DROP CONSTRAINT IF EXISTS tasks_ref_type_check;
ALTER TABLE workflow.tasks
  ADD CONSTRAINT tasks_ref_type_check
  CHECK (ref_type IS NULL OR ref_type IN (
    'leave_app', 'payroll_run', 'procurement_indent', 'procurement_po', 'estab_file', 'asset_disposal',
    'procurement_plan', 'procurement_po_amendment'
  ))
  NOT VALID;

ALTER TABLE workflow.instances VALIDATE CONSTRAINT instances_ref_type_check;
ALTER TABLE workflow.tasks VALIDATE CONSTRAINT tasks_ref_type_check;
