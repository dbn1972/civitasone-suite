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
-- Fix: re-supply both, idempotently, via INSERT...SELECT joined on
-- workflow.definitions by (tenant_id, code) -- immune to the id-mismatch
-- class of bug above, since it resolves the real id rather than assuming a
-- hardcoded one. leave_approval is deliberately excluded from both the node
-- and edge inserts below: its real pre-existing row
-- (aaaaaaaa-0003-0000-0000-000000000001) already carries its own,
-- differently-seeded single node (node_key='manager_approval', singular --
-- NOT 0003's 'manager_approve'/'apply'/'hr_approve'/'complete' set, and
-- definition_edges.from_node/to_node have no FK against node_key, so
-- inserting 0012b's leave_approval edges here would silently create edges
-- pointing at node keys that do not exist for this row rather than fixing
-- anything). leave_approval's incomplete/non-standard demo data is a
-- separate, pre-existing oddity -- flagged in the verification report, not
-- silently patched here since the correct intended flow for this specific
-- row isn't something migration archaeology can safely infer.
--
-- Revised after independent review of the first version of this file caught
-- four real defects (kept here as documentation of what NOT to do, since
-- 0003 itself repeats several of these same mistakes and any future author
-- copying either file should not carry them forward):
--
--  1. The original JOIN matched workflow.definitions by (tenant_id, code)
--     alone. definitions carries UNIQUE (tenant_id, code, version)
--     specifically to allow multiple version rows per code (see
--     0005_engine_hardening.sql), and this service's own designer-deploy
--     flow (repo.ts::archiveOtherVersionsTx) actively creates exactly that
--     on redeploy. On any database where one of these 4 codes has more than
--     one version row, the JOIN would fan out and try to emit the same
--     hardcoded literal node/edge id for two different definition_id
--     values in one statement -- a primary-key collision that rolls back
--     the whole INSERT for all 4 definitions, reproducing the exact
--     single-bad-row-kills-everything failure this migration exists to
--     repair. Fixed by filtering to d.status = 'active' (confirmed on this
--     database: every one of these codes currently has exactly one row, in
--     either 'draft' or 'active' status -- 'active' is the one a user would
--     actually see and interact with).
--  2. The original file's node ids continued in true hex from 0003's last
--     literal suffix (...009, 00a, 00b, ...), but 0003's OWN ids
--     (...009, 010, 011, ...020) are a decimal-style count, not hex --
--     so this file's file_noting node id ...010 was the exact same literal
--     string as 0003's OWN procurement_approval/dept_approve id. On any
--     database where 0003's original 20-row insert succeeded in full (i.e.
--     did NOT hit the leave_approval collision this specific database
--     happens to have), those rows already exist, and this migration's
--     INSERT would hit a hard "duplicate key value violates unique
--     constraint definition_nodes_pkey" on that id -- an unnamed-constraint
--     conflict that ON CONFLICT (definition_id, node_key) does not cover,
--     aborting the statement. Fixed by dropping explicit ids entirely and
--     relying on each table's own DEFAULT gen_random_uuid() -- eliminates
--     the id-collision class of bug altogether rather than picking yet
--     another literal range that could collide with something else later.
--  3. `SET app.tenant_id = ...` was session-scoped, not SET LOCAL inside an
--     explicit transaction. packages/db/src/raw-tenant-guc.ts documents
--     real prior production incidents (helpdesk/crm/estab/hrms/payroll-
--     service) from exactly this shape of statement leaking a tenant GUC
--     onto a pooled connection reused by the next caller. Fixed by wrapping
--     the whole repair in BEGIN/COMMIT with SET LOCAL, which Postgres
--     guarantees resets at transaction end regardless of connection reuse.
--  4. Once explicit ids are dropped (point 2), definition_edges has no
--     unique constraint on the real business key (definition_id, from_node,
--     to_node) -- only a PK on id (see 0005_engine_hardening.sql) -- so a
--     bare `ON CONFLICT DO NOTHING` would no longer be a real idempotency
--     guarantee (a random new id can never conflict with anything, so a
--     second run of this file would silently insert a second, duplicate
--     outgoing edge for every transition). Fixed with an explicit
--     `WHERE NOT EXISTS (...)` guard on that real business key instead of
--     relying on ON CONFLICT for edges.
--
-- Two further review findings are deliberately NOT fixed by editing code,
-- and are called out in this PR's description instead: (a) 0003's own
-- 20-rows-in-one-atomic-INSERT pattern is left as-is -- it is already-
-- applied history elsewhere, and rewriting a merged migration is worse than
-- leaving a documented cautionary example for future authors not to copy;
-- (b) this repair, like 0003 and 0012b before it, writes definition_nodes/
-- definition_edges via raw SQL and so cannot run through the application's
-- own validateGraph structural-safety checks (src/modules/definitions/
-- graph.ts) -- an inherent limitation of raw-SQL seed migrations shared by
-- every migration in this family, not something newly introduced here; the
-- topology below was manually checked to reference only node_keys this same
-- migration also inserts.

BEGIN;
SET lock_timeout = '5s';
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000001';

INSERT INTO workflow.definition_nodes (definition_id, node_key, name, role_ref, sort_order)
SELECT d.id, v.node_key, v.name, v.role_ref, v.sort_order
FROM (VALUES
  -- Finance Approval
  ('finance_approval',     'submit',         'Submission',                'finance_user',           1),
  ('finance_approval',     'accounts_check', 'Accounts Check',            'finance_accountant',     2),
  ('finance_approval',     'budget_officer', 'Budget Officer Review',     'finance_budget_officer', 3),
  ('finance_approval',     'approve',        'Final Approval',            'finance_approver',       4),
  -- Procurement Approval
  ('procurement_approval', 'indent',         'Indent Creation',           'procurement_user',       1),
  ('procurement_approval', 'dept_approve',   'Department Approval',       'procurement_manager',    2),
  ('procurement_approval', 'finance_clear',  'Finance Clearance',         'finance_approver',       3),
  ('procurement_approval', 'po_issue',       'PO Issuance',               'procurement_manager',    4),
  -- File Noting
  ('file_noting',          'draft',           'Draft Note',               'estab_user',             1),
  ('file_noting',          'section_review',  'Section Officer Review',   'estab_section_officer',  2),
  ('file_noting',          'us_approve',      'Under Secretary Approval', 'estab_under_secretary',  3),
  ('file_noting',          'ds_approve',      'Deputy Secretary Approval','estab_deputy_secretary', 4),
  -- Grant Disbursement
  ('grant_disbursement',   'application',     'Grantee Application',      'grant_user',             1),
  ('grant_disbursement',   'scrutiny',        'Application Scrutiny',     'grant_officer',          2),
  ('grant_disbursement',   'sanction',        'Sanction Order',           'grant_approver',         3),
  ('grant_disbursement',   'disbursed',       'Disbursement',             'finance_approver',       4)
) AS v(def_code, node_key, name, role_ref, sort_order)
JOIN workflow.definitions d
  ON d.code = v.def_code
  AND d.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND d.status = 'active'
ON CONFLICT (definition_id, node_key) DO NOTHING;

INSERT INTO workflow.definition_edges (definition_id, from_node, to_node, sort_order)
SELECT d.id, v.from_node, v.to_node, v.sort_order
FROM (VALUES
  -- file_noting: draft → section_review → us_approve → ds_approve (terminal)
  ('file_noting',          'draft',          'section_review',  1),
  ('file_noting',          'section_review', 'us_approve',      1),
  ('file_noting',          'us_approve',     'ds_approve',      1),
  -- finance_approval: submit → accounts_check → budget_officer → approve (terminal)
  ('finance_approval',     'submit',         'accounts_check',  1),
  ('finance_approval',     'accounts_check', 'budget_officer',  1),
  ('finance_approval',     'budget_officer', 'approve',         1),
  -- procurement_approval: indent → dept_approve → finance_clear → po_issue (terminal)
  ('procurement_approval', 'indent',         'dept_approve',    1),
  ('procurement_approval', 'dept_approve',   'finance_clear',   1),
  ('procurement_approval', 'finance_clear',  'po_issue',        1),
  -- grant_disbursement: application → scrutiny → sanction → disbursed (terminal)
  ('grant_disbursement',   'application',    'scrutiny',        1),
  ('grant_disbursement',   'scrutiny',       'sanction',        1),
  ('grant_disbursement',   'sanction',       'disbursed',       1)
) AS v(def_code, from_node, to_node, sort_order)
JOIN workflow.definitions d
  ON d.code = v.def_code
  AND d.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND d.status = 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM workflow.definition_edges e2
  WHERE e2.definition_id = d.id
    AND e2.from_node = v.from_node
    AND e2.to_node = v.to_node
);

COMMIT;
