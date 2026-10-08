-- 0021_contract_table_prefix.sql
--
-- GAP2-CONTRACT-TABLE-PREFIX-05 — CLAUDE.md architecture rule 2 ("one service,
-- one prefix: every table starts with `{service}_`") is violated by six
-- contract-service tables that lack the `contract_` prefix. Isolation (RLS +
-- FORCE + tenant_id + policy) is already correct on all six; only the NAME
-- drifted, undermining the "liftable with one connection string" guarantee and
-- the cross-prefix-join CI guard.
--
-- This renames each offending table to its prefixed form. A RENAME preserves
-- the table's RLS policies, grants, indexes, constraints and data in place, so
-- no re-grant or backfill is needed (verified: siblings created with the prefix
-- — contracts.contract_contracts, rate.contract_rate_contracts,
-- versions.contract_versions — carry no extra grants beyond what RENAME keeps).
--
-- Tables renamed (schema.table  ->  new name):
--   approvals.approval_levels        -> approvals.contract_approval_levels
--   clauses.clause_library           -> clauses.contract_clause_library
--   esign.esign_routes               -> esign.contract_esign_routes
--   obligations.obligation_reminders -> obligations.contract_obligation_reminders
--   templates.template_clauses       -> templates.contract_template_clauses
--   versions.redlines                -> versions.contract_redlines
--
-- The matching Drizzle `.table("...")` physical names were updated in the same
-- change (services/contract-service/src/modules/{approvals,clauses,esign,
-- obligations,templates,versions}/schema.ts), so model and DB stay consistent
-- (schema-drift-guard.mjs reads the `.table("y")` string).
--
-- Idempotent: each rename runs only when the OLD name still exists and the NEW
-- name does not, so re-running the file (or applying it after the rename has
-- already happened) is a no-op rather than an error.
--
-- Rollback:
--   ALTER TABLE approvals.contract_approval_levels RENAME TO approval_levels;
--   ALTER TABLE clauses.contract_clause_library RENAME TO clause_library;
--   ALTER TABLE esign.contract_esign_routes RENAME TO esign_routes;
--   ALTER TABLE obligations.contract_obligation_reminders RENAME TO obligation_reminders;
--   ALTER TABLE templates.contract_template_clauses RENAME TO template_clauses;
--   ALTER TABLE versions.contract_redlines RENAME TO redlines;
--
-- Affected services: contract-service (approvals, clauses, esign, obligations,
-- templates, versions modules). Additive and idempotent.

SET lock_timeout = '5s';

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('approvals',   'approval_levels',       'contract_approval_levels'),
      ('clauses',     'clause_library',        'contract_clause_library'),
      ('esign',       'esign_routes',          'contract_esign_routes'),
      ('obligations', 'obligation_reminders',  'contract_obligation_reminders'),
      ('templates',   'template_clauses',      'contract_template_clauses'),
      ('versions',    'redlines',              'contract_redlines')
    ) AS t(sch, old_name, new_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = r.sch AND table_name = r.old_name
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = r.sch AND table_name = r.new_name
    ) THEN
      EXECUTE format('ALTER TABLE %I.%I RENAME TO %I', r.sch, r.old_name, r.new_name);
    END IF;
  END LOOP;
END $$;
