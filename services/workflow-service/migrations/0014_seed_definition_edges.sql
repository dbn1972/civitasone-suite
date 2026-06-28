-- 0014: Seed the missing definition_edges for the demo-tenant standard
-- definitions. Migration 0003 inserted nodes but NO edges, so the chains
-- (file_noting SO→US→DS, etc.) could not advance — completing the start task
-- found zero outgoing edges and terminated immediately. This adds the linear
-- approve-advances edges. New tenants get these via the provisioning consumer.

-- file_noting: draft → section_review → us_approve → ds_approve (terminal)
INSERT INTO workflow.definition_edges (id, definition_id, from_node, to_node, sort_order)
VALUES
  ('00000000-0000-4004-8001-000000000001', '00000000-0000-4002-8001-000000000004', 'draft',          'section_review', 1),
  ('00000000-0000-4004-8001-000000000002', '00000000-0000-4002-8001-000000000004', 'section_review', 'us_approve',     1),
  ('00000000-0000-4004-8001-000000000003', '00000000-0000-4002-8001-000000000004', 'us_approve',     'ds_approve',     1),
  -- leave_approval: apply → manager_approve → hr_approve (terminal)
  ('00000000-0000-4004-8001-000000000004', '00000000-0000-4002-8001-000000000001', 'apply',          'manager_approve', 1),
  ('00000000-0000-4004-8001-000000000005', '00000000-0000-4002-8001-000000000001', 'manager_approve','hr_approve',      1),
  -- finance_approval: submit → accounts_check → budget_officer → approve (terminal)
  ('00000000-0000-4004-8001-000000000006', '00000000-0000-4002-8001-000000000002', 'submit',         'accounts_check',  1),
  ('00000000-0000-4004-8001-000000000007', '00000000-0000-4002-8001-000000000002', 'accounts_check', 'budget_officer',  1),
  ('00000000-0000-4004-8001-000000000008', '00000000-0000-4002-8001-000000000002', 'budget_officer', 'approve',         1),
  -- procurement_approval: indent → dept_approve → finance_clear → po_issue (terminal)
  ('00000000-0000-4004-8001-000000000009', '00000000-0000-4002-8001-000000000003', 'indent',         'dept_approve',    1),
  ('00000000-0000-4004-8001-00000000000a', '00000000-0000-4002-8001-000000000003', 'dept_approve',   'finance_clear',   1),
  ('00000000-0000-4004-8001-00000000000b', '00000000-0000-4002-8001-000000000003', 'finance_clear',  'po_issue',        1),
  -- grant_disbursement: application → scrutiny → sanction → disbursed (terminal)
  ('00000000-0000-4004-8001-00000000000c', '00000000-0000-4002-8001-000000000005', 'application',    'scrutiny',        1),
  ('00000000-0000-4004-8001-00000000000d', '00000000-0000-4002-8001-000000000005', 'scrutiny',       'sanction',        1),
  ('00000000-0000-4004-8001-00000000000e', '00000000-0000-4002-8001-000000000005', 'sanction',       'disbursed',       1)
ON CONFLICT DO NOTHING;
