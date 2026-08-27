-- Repair: standard demo-tenant workflow definitions with parent rows but no
-- traversable graph.
--
-- Root cause #1 (definition_nodes): 0003_seed_definitions.sql inserts all 5
-- standard definitions in one INSERT (ON CONFLICT (tenant_id, code) DO
-- NOTHING), then all 20 of their nodes in a SECOND, single atomic multi-row
-- INSERT keyed by hardcoded definition_id values. On this database, a
-- workflow.definitions row for code='leave_approval' already existed under a
-- DIFFERENT id (00000000-0000-4002-8001-000000000001 was never actually
-- inserted -- the real row is aaaaaaaa-0003-0000-0000-000000000001, from an
-- earlier/ad-hoc seeding pass), so 0003's own leave_approval definitions-row
-- insert hit its ON CONFLICT and was skipped. The node INSERT that follows
-- in the SAME migration still references the hardcoded (nonexistent as a
-- real row) leave_approval id, which violates definition_nodes' FK on
-- definition_id -- and because all 20 rows (for 5 definitions) were in ONE
-- INSERT...VALUES statement, that single FK violation rolled back the WHOLE
-- statement. finance_approval, procurement_approval, file_noting, and
-- grant_disbursement lost their node seeding too, even though THEIR parent
-- definitions rows inserted successfully moments earlier in the same
-- migration. Verified directly against this database: those 4 definitions
-- have zero definition_nodes dated from the original 2026-06 seeding window,
-- while every OTHER standard/demo definition that didn't collide on code has
-- its nodes intact.
--
-- Root cause #2 (definition_edges): 0012b_seed_definition_edges.sql (which
-- seeds edges for leave_approval/finance_approval/procurement_approval/
-- file_noting/grant_disbursement, referencing definition_id directly rather
-- than through the buggy node-dependent path above) was never applied to
-- this database at all -- verified directly: zero definition_edges rows
-- exist for any of those 5 definition_ids, while the 3 definitions seeded
-- through a different path (flow6-31a97c64, sec_t_ok, sec_t_ok2) do have
-- edges, all dated 2026-06-24. This is a live, user-facing gap: exactly the
-- symptom 0012b's own commit message describes ("completing the start task
-- found zero outgoing edges and terminated immediately") is still happening
-- today for these 5 standard definitions on this database, despite 0012b
-- existing in source and 0013/0018/0020/0029's RLS policies already being
-- correctly live.
--
-- Fix: re-supply both, idempotently. Nodes are inserted via INSERT...SELECT
-- joined on workflow.definitions by (tenant_id, code) rather than a
-- hardcoded definition_id -- immune to the id-mismatch class of bug above,
-- and naturally a no-op (ON CONFLICT DO NOTHING) for any definition whose
-- nodes already exist. leave_approval is deliberately excluded from both the
-- node and edge inserts below: its real pre-existing row
-- (aaaaaaaa-0003-0000-0000-000000000001) already carries its own,
-- differently-seeded single node (node_key='manager_approval', singular --
-- NOT 0003's 'manager_approve'/'apply'/'hr_approve'/'complete' set, and
-- definition_edges.from_node/to_node have no FK against node_key, so
-- inserting 0012b's leave_approval edges here would silently create edges
-- pointing at node keys that do not exist for this row rather than fixing
-- anything). leave_approval's incomplete/non-standard demo data is a
-- separate, pre-existing oddity -- flagged in the verification report, not
-- silently patched here since the correct intended flow for this
-- specific row isn't something migration archaeology can safely infer.
-- The other 4 definitions' edges are the exact content of 0012b for them,
-- safe to (re-)apply since it is itself ON CONFLICT DO NOTHING and none of
-- these rows exist yet on this database.
--
-- workflow.definitions carries FORCE ROW LEVEL SECURITY (tenant_id =
-- workflow.current_tenant_id()), so the code-lookup JOIN below needs to be
-- able to see that row. Rather than assume the role executing this migration
-- has BYPASSRLS (some migration runners use a superuser/owner role for DDL
-- and a tenant-scoped app role for DML seeds -- this repo should not depend
-- on which), set the session's tenant context explicitly for the duration
-- of this migration, exactly as 0003/0012b already hardcode this same
-- tenant directly in their own VALUES lists. Confirmed by direct testing
-- against this database: without this SET, the JOIN silently sees zero rows
-- and both inserts below become a correctness-silent no-op (INSERT 0 0) --
-- the same "quietly does nothing" failure mode this migration exists to fix.
SET app.tenant_id = '00000000-0000-0000-0000-000000000001';

INSERT INTO workflow.definition_nodes (id, definition_id, node_key, name, role_ref, sort_order)
SELECT v.id, d.id, v.node_key, v.name, v.role_ref, v.sort_order
FROM (VALUES
  -- Finance Approval
  ('00000000-0000-4003-8001-000000000005'::uuid, 'finance_approval',     'submit',         'Submission',                'finance_user',           1),
  ('00000000-0000-4003-8001-000000000006'::uuid, 'finance_approval',     'accounts_check', 'Accounts Check',            'finance_accountant',     2),
  ('00000000-0000-4003-8001-000000000007'::uuid, 'finance_approval',     'budget_officer', 'Budget Officer Review',     'finance_budget_officer', 3),
  ('00000000-0000-4003-8001-000000000008'::uuid, 'finance_approval',     'approve',        'Final Approval',            'finance_approver',       4),
  -- Procurement Approval
  ('00000000-0000-4003-8001-000000000009'::uuid, 'procurement_approval', 'indent',         'Indent Creation',           'procurement_user',       1),
  ('00000000-0000-4003-8001-00000000000a'::uuid, 'procurement_approval', 'dept_approve',   'Department Approval',       'procurement_manager',    2),
  ('00000000-0000-4003-8001-00000000000b'::uuid, 'procurement_approval', 'finance_clear',  'Finance Clearance',         'finance_approver',       3),
  ('00000000-0000-4003-8001-00000000000c'::uuid, 'procurement_approval', 'po_issue',       'PO Issuance',               'procurement_manager',    4),
  -- File Noting
  ('00000000-0000-4003-8001-00000000000d'::uuid, 'file_noting',          'draft',           'Draft Note',               'estab_user',             1),
  ('00000000-0000-4003-8001-00000000000e'::uuid, 'file_noting',          'section_review',  'Section Officer Review',   'estab_section_officer',  2),
  ('00000000-0000-4003-8001-00000000000f'::uuid, 'file_noting',          'us_approve',      'Under Secretary Approval', 'estab_under_secretary',  3),
  ('00000000-0000-4003-8001-000000000010'::uuid, 'file_noting',          'ds_approve',      'Deputy Secretary Approval','estab_deputy_secretary', 4),
  -- Grant Disbursement
  ('00000000-0000-4003-8001-000000000011'::uuid, 'grant_disbursement',   'application',     'Grantee Application',      'grant_user',             1),
  ('00000000-0000-4003-8001-000000000012'::uuid, 'grant_disbursement',   'scrutiny',        'Application Scrutiny',     'grant_officer',          2),
  ('00000000-0000-4003-8001-000000000013'::uuid, 'grant_disbursement',   'sanction',        'Sanction Order',           'grant_approver',         3),
  ('00000000-0000-4003-8001-000000000014'::uuid, 'grant_disbursement',   'disbursed',       'Disbursement',             'finance_approver',       4)
) AS v(id, def_code, node_key, name, role_ref, sort_order)
JOIN workflow.definitions d ON d.code = v.def_code AND d.tenant_id = '00000000-0000-0000-0000-000000000001'
ON CONFLICT (definition_id, node_key) DO NOTHING;

INSERT INTO workflow.definition_edges (id, definition_id, from_node, to_node, sort_order)
SELECT v.id, d.id, v.from_node, v.to_node, v.sort_order
FROM (VALUES
  -- file_noting: draft → section_review → us_approve → ds_approve (terminal)
  ('00000000-0000-4004-8001-000000000001'::uuid, 'file_noting',          'draft',          'section_review',  1),
  ('00000000-0000-4004-8001-000000000002'::uuid, 'file_noting',          'section_review', 'us_approve',      1),
  ('00000000-0000-4004-8001-000000000003'::uuid, 'file_noting',          'us_approve',     'ds_approve',      1),
  -- finance_approval: submit → accounts_check → budget_officer → approve (terminal)
  ('00000000-0000-4004-8001-000000000006'::uuid, 'finance_approval',     'submit',         'accounts_check',  1),
  ('00000000-0000-4004-8001-000000000007'::uuid, 'finance_approval',     'accounts_check', 'budget_officer',  1),
  ('00000000-0000-4004-8001-000000000008'::uuid, 'finance_approval',     'budget_officer', 'approve',         1),
  -- procurement_approval: indent → dept_approve → finance_clear → po_issue (terminal)
  ('00000000-0000-4004-8001-000000000009'::uuid, 'procurement_approval', 'indent',         'dept_approve',    1),
  ('00000000-0000-4004-8001-00000000000a'::uuid, 'procurement_approval', 'dept_approve',   'finance_clear',   1),
  ('00000000-0000-4004-8001-00000000000b'::uuid, 'procurement_approval', 'finance_clear',  'po_issue',        1),
  -- grant_disbursement: application → scrutiny → sanction → disbursed (terminal)
  ('00000000-0000-4004-8001-00000000000c'::uuid, 'grant_disbursement',   'application',    'scrutiny',        1),
  ('00000000-0000-4004-8001-00000000000d'::uuid, 'grant_disbursement',   'scrutiny',       'sanction',        1),
  ('00000000-0000-4004-8001-00000000000e'::uuid, 'grant_disbursement',   'sanction',       'disbursed',       1)
) AS v(id, def_code, from_node, to_node, sort_order)
JOIN workflow.definitions d ON d.code = v.def_code AND d.tenant_id = '00000000-0000-0000-0000-000000000001'
ON CONFLICT DO NOTHING;
