-- 0140_onboarding_documents.sql
-- COMP-015: real per-employee onboarding document checklist status.
-- Additive + idempotent. FORCE RLS on app.tenant_id GUC (lifecycle schema),
-- matching the convention established in 0101_onboarding_structured_data.sql.
--
-- Rollback: DROP TABLE IF EXISTS lifecycle.hrms_onboarding_documents;

SET lock_timeout = '5s';

-- Per-employee document status. The CATALOGUE of which doc types apply to an
-- employee already exists (lifecycle.hrms_mandatory_doc_configs, 0101) -- this
-- table holds only what is genuinely per-employee: what THIS employee has
-- actually submitted or had verified. One row per (tenant, employee, doc
-- type); onboarding-routes.ts's mark-received/verify handlers upsert on that
-- key via the unique index below.
--
-- Deliberately NOT seeded here with a cross-tenant backfill into
-- hrms_mandatory_doc_configs (an earlier draft of this migration tried that,
-- looping `SELECT DISTINCT tenant_id, employee_type FROM employee.hrms_employees`
-- and inserting a default catalogue per tenant). Verified against a live
-- Postgres that this does not work as a plain migration: hrms-service
-- migrations run as the `hrms_svc` role (see scripts/ci/bootstrap-postgres.sh
-- -- hrms-service is not in ADMIN_OWNED_DBS), and employee.hrms_employees'
-- own RLS policy (`tenant_id = employee.current_tenant_id()`, i.e.
-- current_setting('app.tenant_id')) means that SELECT sees ZERO rows with no
-- tenant GUC set -- a migration that silently seeds nothing while reporting
-- success is exactly the "fake success" bug class this campaign has
-- repeatedly hunted down elsewhere (see f3-consumer.ts's own header comment).
-- Reading employee.* from a lifecycle migration also crosses the module
-- boundary AGENTS.md asks services to keep closed ("no JOINs across module
-- schemas"). Correctly bypassing RLS for a one-off cross-tenant backfill
-- (BYPASSRLS on hrms_svc, or a superuser-run migration) is a real option but
-- a materially bigger, security-sensitive change than this gap warrants --
-- the in-code fallback below already gives every employee a correct,
-- non-fabricated checklist with no backfill required. If a future change
-- wants configured (not just defaulted) mandatory-doc-configs rows for
-- existing tenants, do it as an explicitly superuser-run or admin-tool-driven
-- backfill, not a plain service-role migration.
--
-- What actually covers "the seed default the gap report asked for" instead:
-- onboarding-routes.ts's mergeOnboardingDocuments() falls back to an in-code
-- DEFAULT_DOC_CATALOGUE (the same 6 document types) whenever a tenant has
-- configured no hrms_mandatory_doc_configs rows yet for an employee's type --
-- covering every existing tenant today and every new tenant going forward,
-- with no migration-time backfill required.
CREATE TABLE IF NOT EXISTS lifecycle.hrms_onboarding_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL, employee_id uuid NOT NULL,
  doc_type      varchar(64) NOT NULL,
  status        varchar(16) NOT NULL DEFAULT 'pending',
  received_at   timestamptz, verified_by uuid, verified_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL, version integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_onbdoc_status_check CHECK (status IN ('pending','uploaded','verified','rejected'))
);
CREATE UNIQUE INDEX IF NOT EXISTS hrms_onbdoc_emp_doctype_uq ON lifecycle.hrms_onboarding_documents (tenant_id, employee_id, doc_type);
CREATE INDEX IF NOT EXISTS hrms_onbdoc_emp_idx ON lifecycle.hrms_onboarding_documents (tenant_id, employee_id);

ALTER TABLE lifecycle.hrms_onboarding_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.hrms_onboarding_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_onboarding_documents_tenant ON lifecycle.hrms_onboarding_documents;
CREATE POLICY hrms_onboarding_documents_tenant ON lifecycle.hrms_onboarding_documents
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON lifecycle.hrms_onboarding_documents TO hrms_svc;
