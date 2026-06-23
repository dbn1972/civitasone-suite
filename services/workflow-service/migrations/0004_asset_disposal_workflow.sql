-- Asset disposal approval workflow (Oracle FA / SAP AA retirement parity)

INSERT INTO workflow.definitions (id, tenant_id, code, name, version, status, created_by, updated_by)
VALUES
  ('00000000-0000-4002-8001-000000000006', '00000000-0000-0000-0000-000000000001',
   'asset_disposal', 'Asset Disposal Approval', 1, 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099')
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO workflow.definition_nodes (id, definition_id, node_key, name, role_ref, sort_order)
VALUES
  ('00000000-0000-4003-8001-000000000021', '00000000-0000-4002-8001-000000000006',
   'request', 'Disposal Request', 'asset_manager', 1),
  ('00000000-0000-4003-8001-000000000022', '00000000-0000-4002-8001-000000000006',
   'committee', 'Write-off Committee', 'asset_admin', 2),
  ('00000000-0000-4003-8001-000000000023', '00000000-0000-4002-8001-000000000006',
   'finance', 'Finance Clearance', 'finance_approver', 3),
  ('00000000-0000-4003-8001-000000000024', '00000000-0000-4002-8001-000000000006',
   'complete', 'Retirement Posted', NULL, 4)
ON CONFLICT (definition_id, node_key) DO NOTHING;
