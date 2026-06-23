-- Seed standard workflow definitions for the default demo tenant
-- tenant_id: 00000000-0000-0000-0000-000000000001
-- actor:     00000000-0000-0000-0000-000000000099

INSERT INTO workflow.definitions (id, tenant_id, code, name, version, status, created_by, updated_by)
VALUES
  ('00000000-0000-4002-8001-000000000001', '00000000-0000-0000-0000-000000000001',
   'leave_approval', 'Leave Approval Workflow', 1, 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4002-8001-000000000002', '00000000-0000-0000-0000-000000000001',
   'finance_approval', 'Finance Approval Workflow', 1, 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4002-8001-000000000003', '00000000-0000-0000-0000-000000000001',
   'procurement_approval', 'Procurement Approval Workflow', 1, 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4002-8001-000000000004', '00000000-0000-0000-0000-000000000001',
   'file_noting', 'File Noting & Approval Workflow', 1, 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4002-8001-000000000005', '00000000-0000-0000-0000-000000000001',
   'grant_disbursement', 'Grant Disbursement Workflow', 1, 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099')
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO workflow.definition_nodes (id, definition_id, node_key, name, role_ref, sort_order)
VALUES
  -- Leave Approval
  ('00000000-0000-4003-8001-000000000001', '00000000-0000-4002-8001-000000000001',
   'apply', 'Employee Application', 'hrms_employee', 1),
  ('00000000-0000-4003-8001-000000000002', '00000000-0000-4002-8001-000000000001',
   'manager_approve', 'Manager Approval', 'hrms_manager', 2),
  ('00000000-0000-4003-8001-000000000003', '00000000-0000-4002-8001-000000000001',
   'hr_approve', 'HR Approval', 'hrms_hr', 3),
  ('00000000-0000-4003-8001-000000000004', '00000000-0000-4002-8001-000000000001',
   'complete', 'Completed', NULL, 4),
  -- Finance Approval
  ('00000000-0000-4003-8001-000000000005', '00000000-0000-4002-8001-000000000002',
   'submit', 'Submission', 'finance_user', 1),
  ('00000000-0000-4003-8001-000000000006', '00000000-0000-4002-8001-000000000002',
   'accounts_check', 'Accounts Check', 'finance_accountant', 2),
  ('00000000-0000-4003-8001-000000000007', '00000000-0000-4002-8001-000000000002',
   'budget_officer', 'Budget Officer Review', 'finance_budget_officer', 3),
  ('00000000-0000-4003-8001-000000000008', '00000000-0000-4002-8001-000000000002',
   'approve', 'Final Approval', 'finance_approver', 4),
  -- Procurement Approval
  ('00000000-0000-4003-8001-000000000009', '00000000-0000-4002-8001-000000000003',
   'indent', 'Indent Creation', 'procurement_user', 1),
  ('00000000-0000-4003-8001-000000000010', '00000000-0000-4002-8001-000000000003',
   'dept_approve', 'Department Approval', 'procurement_manager', 2),
  ('00000000-0000-4003-8001-000000000011', '00000000-0000-4002-8001-000000000003',
   'finance_clear', 'Finance Clearance', 'finance_approver', 3),
  ('00000000-0000-4003-8001-000000000012', '00000000-0000-4002-8001-000000000003',
   'po_issue', 'PO Issuance', 'procurement_manager', 4),
  -- File Noting
  ('00000000-0000-4003-8001-000000000013', '00000000-0000-4002-8001-000000000004',
   'draft', 'Draft Note', 'estab_user', 1),
  ('00000000-0000-4003-8001-000000000014', '00000000-0000-4002-8001-000000000004',
   'section_review', 'Section Officer Review', 'estab_section_officer', 2),
  ('00000000-0000-4003-8001-000000000015', '00000000-0000-4002-8001-000000000004',
   'us_approve', 'Under Secretary Approval', 'estab_under_secretary', 3),
  ('00000000-0000-4003-8001-000000000016', '00000000-0000-4002-8001-000000000004',
   'ds_approve', 'Deputy Secretary Approval', 'estab_deputy_secretary', 4),
  -- Grant Disbursement
  ('00000000-0000-4003-8001-000000000017', '00000000-0000-4002-8001-000000000005',
   'application', 'Grantee Application', 'grant_user', 1),
  ('00000000-0000-4003-8001-000000000018', '00000000-0000-4002-8001-000000000005',
   'scrutiny', 'Application Scrutiny', 'grant_officer', 2),
  ('00000000-0000-4003-8001-000000000019', '00000000-0000-4002-8001-000000000005',
   'sanction', 'Sanction Order', 'grant_approver', 3),
  ('00000000-0000-4003-8001-000000000020', '00000000-0000-4002-8001-000000000005',
   'disbursed', 'Disbursement', 'finance_approver', 4)
ON CONFLICT (definition_id, node_key) DO NOTHING;
