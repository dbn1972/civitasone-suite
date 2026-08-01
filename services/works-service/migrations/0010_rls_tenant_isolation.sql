-- Purpose: Enable + FORCE RLS tenant isolation on works.* + outbox.
-- Idempotent / additive. Affected: works-service
SET lock_timeout = '5s';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    '_outbox.messages',
    'works.account_compilations',
    'works.administrative_approvals',
    'works.assets',
    'works.authorities',
    'works.awards',
    'works.bill_items',
    'works.bill_recoveries',
    'works.bills',
    'works.boq_items',
    'works.contractor_classes',
    'works.financial_targets',
    'works.issue_description_types',
    'works.issue_observations',
    'works.issue_types',
    'works.material_coefficients',
    'works.measurement_books',
    'works.measurements',
    'works.physical_completions',
    'works.physical_targets',
    'works.pre_tenders',
    'works.programs',
    'works.proposer_types',
    'works.publication_levels',
    'works.quotation_items',
    'works.quotations',
    'works.recapitulation',
    'works.repair_types',
    'works.schedule_a_items',
    'works.schemes',
    'works.scope_progress',
    'works.scopes',
    'works.sr_items',
    'works.technical_sanctions',
    'works.tender_types',
    'works.tenders',
    'works.user_departments',
    'works.work_closures',
    'works.work_coa_mappings',
    'works.work_description_types',
    'works.work_issues',
    'works.work_office_mappings',
    'works.work_photos',
    'works.work_proposals',
    'works.work_scopes',
    'works.work_splits',
    'works.work_sub_types',
    'works.work_types'
  ]
  LOOP
    IF to_regclass(t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %s', t);
    EXECUTE format(
      $f$CREATE POLICY tenant_isolation_policy ON %s
         USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
         WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$f$,
      t
    );
  END LOOP;
END $$;

