-- Migration 0018: canonical journey metric definitions (DATA migration for G4)
--
-- Purpose:
--   Seeds the platform-standard (`governance = 'canonical'`, `status = 'published'`)
--   definitions for the measurement points the six customer journeys require. These
--   are the definitions two tenants must agree on before their numbers can be
--   compared. Keys and names are deliberately generic and product-neutral — no
--   customer's domain vocabulary is hardcoded.
--
--   This is a DATA migration, kept separate from the schema migration
--   (0017_metric_definitions.sql) per the migration safety rules.
--
-- Tenant scoping:
--   There was no existing precedent in report-service for a platform-wide seed, so
--   this follows notification-service/0003_system_templates.sql: platform-owned
--   reference rows carry the nil uuid tenant_id
--   ('00000000-0000-0000-0000-000000000000'). Migration 0017's RLS policy grants
--   every tenant READ access to that tenant_id while WITH CHECK still restricts
--   writes to the caller's own tenant, so canonical rows are visible everywhere and
--   writable nowhere. A tenant that needs different targets/dimensions forks the row
--   via POST /v1/reports/metrics/:id/versions, which creates a tenant-owned draft.
--
-- Idempotency:
--   Fixed ids plus ON CONFLICT on the (tenant_id, metric_key, version_number)
--   unique index — re-running is a no-op and never duplicates or overwrites a
--   definition. Row count is small (14), so no batching is required.
--
-- Rollback:
--   DELETE FROM reports.metric_definitions
--    WHERE tenant_id = '00000000-0000-0000-0000-000000000000'
--      AND governance = 'canonical'
--      AND version_number = 1;
--   (Safe: no tenant data is stored on these rows. Tenant-owned forks are separate
--   rows and are NOT removed by the rollback.)
--
-- Affected services: report-service (owner); analytics-service and ai-agent-service
--   read the definitions through GET /v1/reports/metrics.

SET lock_timeout = '5s';

INSERT INTO reports.metric_definitions (
  id, tenant_id, metric_key, display_name, description, module, unit, aggregation,
  numerator_source, denominator_source, dimensions, period, target_value,
  higher_is_better, governance, version_number, status, published_at,
  created_by, updated_by, version
) VALUES
  ('00000000-0000-4000-8004-000000000001', '00000000-0000-0000-0000-000000000000',
   'crm.lead_to_agreement_cycle_days', 'Lead to agreement cycle time (days)',
   'Mean elapsed days from lead creation to a signed agreement. Measures acquisition throughput.',
   'crm', 'days', 'avg',
   'crm.lead_to_agreement_cycle', NULL,
   '["region","channel","source","ownerId"]'::jsonb, 'monthly', NULL,
   false, 'canonical', 1, 'published', now(),
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 1),

  ('00000000-0000-4000-8004-000000000002', '00000000-0000-0000-0000-000000000000',
   'crm.onboarding_first_action_within_n_days_rate', 'Onboarding first action within N days rate',
   'Share of newly onboarded customers who complete a first qualifying action inside the configured window.',
   'crm', 'percent', 'ratio',
   'crm.onboarded_first_action_within_window', 'crm.onboarded_customers',
   '["region","channel","segment"]'::jsonb, 'monthly', NULL,
   true, 'canonical', 1, 'published', now(),
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 1),

  ('00000000-0000-4000-8004-000000000003', '00000000-0000-0000-0000-000000000000',
   'crm.retention_90d_rate', 'Retention rate (90 day)',
   'Share of customers active at the start of a rolling 90-day window who are still active at the end.',
   'crm', 'percent', 'ratio',
   'crm.retained_customers_90d', 'crm.customers_at_window_start',
   '["region","segment","cohort"]'::jsonb, 'rolling_90d', NULL,
   true, 'canonical', 1, 'published', now(),
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 1),

  ('00000000-0000-4000-8004-000000000004', '00000000-0000-0000-0000-000000000000',
   'crm.share_of_wallet_pct', 'Share of wallet',
   'Share of a customer''s addressable spend captured by this organisation.',
   'crm', 'percent', 'ratio',
   'crm.captured_spend_minor', 'crm.addressable_spend_minor',
   '["region","segment","productCategory"]'::jsonb, 'quarterly', NULL,
   true, 'canonical', 1, 'published', now(),
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 1),

  ('00000000-0000-4000-8004-000000000005', '00000000-0000-0000-0000-000000000000',
   'crm.complaint_rate_per_thousand_txn', 'Complaint rate per thousand transactions',
   'Complaints raised per 1,000 completed transactions. A quality signal, so lower is better.',
   'crm', 'count', 'ratio',
   'crm.complaints_raised', 'crm.transactions_completed_thousands',
   '["region","channel","productCategory"]'::jsonb, 'monthly', NULL,
   false, 'canonical', 1, 'published', now(),
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 1),

  ('00000000-0000-4000-8004-000000000006', '00000000-0000-0000-0000-000000000000',
   'crm.renewal_retention_rate', 'Renewal retention rate',
   'Share of renewal-eligible agreements that were renewed within the grace window.',
   'crm', 'percent', 'ratio',
   'crm.agreements_renewed', 'crm.agreements_renewal_due',
   '["region","channel","productCategory"]'::jsonb, 'monthly', NULL,
   true, 'canonical', 1, 'published', now(),
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 1),

  ('00000000-0000-4000-8004-000000000007', '00000000-0000-0000-0000-000000000000',
   'crm.cross_sell_attach_rate', 'Cross-sell attach rate',
   'Share of eligible customers who took an additional product following a cross-sell recommendation.',
   'crm', 'percent', 'ratio',
   'crm.cross_sell_accepted', 'crm.cross_sell_eligible',
   '["region","channel","productId","segment"]'::jsonb, 'monthly', NULL,
   true, 'canonical', 1, 'published', now(),
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 1),

  ('00000000-0000-4000-8004-000000000008', '00000000-0000-0000-0000-000000000000',
   'crm.contact_to_conversion_rate', 'Contact to conversion rate',
   'Share of outbound or inbound contacts that converted to a qualified outcome.',
   'crm', 'percent', 'ratio',
   'crm.contacts_converted', 'crm.contacts_attempted',
   '["region","channel","campaignId","ownerId"]'::jsonb, 'monthly', NULL,
   true, 'canonical', 1, 'published', now(),
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 1),

  ('00000000-0000-4000-8004-000000000009', '00000000-0000-0000-0000-000000000000',
   'service.first_contact_resolution_rate', 'First contact resolution rate',
   'Share of service interactions resolved on the first contact, with no follow-up required.',
   'service', 'percent', 'ratio',
   'service.interactions_resolved_first_contact', 'service.interactions_total',
   '["region","channel","queue","skill"]'::jsonb, 'monthly', NULL,
   true, 'canonical', 1, 'published', now(),
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 1),

  ('00000000-0000-4000-8004-00000000000a', '00000000-0000-0000-0000-000000000000',
   'service.repeat_contact_rate', 'Repeat contact rate',
   'Share of resolved interactions followed by another contact on the same issue inside the window. Lower is better.',
   'service', 'percent', 'ratio',
   'service.repeat_contacts', 'service.interactions_resolved',
   '["region","channel","queue"]'::jsonb, 'rolling_30d', NULL,
   false, 'canonical', 1, 'published', now(),
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 1),

  ('00000000-0000-4000-8004-00000000000b', '00000000-0000-0000-0000-000000000000',
   'service.post_resolution_retention_delta_pct', 'Post-resolution retention delta',
   'Difference in retention between customers whose issue was resolved and the comparison cohort.',
   'service', 'percent', 'ratio',
   'service.retained_post_resolution', 'service.resolved_cohort_size',
   '["region","channel","segment"]'::jsonb, 'quarterly', NULL,
   true, 'canonical', 1, 'published', now(),
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 1),

  ('00000000-0000-4000-8004-00000000000c', '00000000-0000-0000-0000-000000000000',
   'crm.case_issuance_tat_days', 'Case issuance turnaround (days)',
   'Mean elapsed days from case submission to issuance of the resulting record. Lower is better.',
   'crm', 'days', 'avg',
   'crm.case_issuance_turnaround', NULL,
   '["region","channel","caseType"]'::jsonb, 'monthly', NULL,
   false, 'canonical', 1, 'published', now(),
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 1),

  ('00000000-0000-4000-8004-00000000000d', '00000000-0000-0000-0000-000000000000',
   'crm.thirteen_month_persistency_rate', 'Thirteen month persistency rate',
   'Share of agreements still in force thirteen months after commencement.',
   'crm', 'percent', 'ratio',
   'crm.agreements_in_force_month_13', 'crm.agreements_commenced',
   '["region","channel","productCategory","ownerId"]'::jsonb, 'monthly', NULL,
   true, 'canonical', 1, 'published', now(),
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 1),

  ('00000000-0000-4000-8004-00000000000e', '00000000-0000-0000-0000-000000000000',
   'crm.agent_productivity_per_period', 'Agent productivity per period',
   'Count of qualifying completed actions per agent in the period.',
   'crm', 'count', 'count',
   'crm.agent_completed_actions', NULL,
   '["region","channel","ownerId","team"]'::jsonb, 'monthly', NULL,
   true, 'canonical', 1, 'published', now(),
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 1)
ON CONFLICT (tenant_id, metric_key, version_number) DO NOTHING;
