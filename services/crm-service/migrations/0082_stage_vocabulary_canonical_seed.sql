-- Purpose: G1 data migration — seed the CANONICAL stage vocabulary.
--   Schema lives in 0079; this file only inserts rows, per the "data migrations are a
--   separate file" rule. Eight rows, so no batching is needed.
--
--   The vocabulary is deliberately PRODUCT-AGNOSTIC: a generic commercial journey from
--   first contact to churn. No sector-specific stages are seeded here. Sector or
--   department vocabulary belongs in that tenant's own governance='tenant' rows (or in
--   tenant seed data), because platform code that ships one customer's vocabulary is
--   hardcoded tenant-specific logic.
--
--   Owner is the platform sentinel tenant 00000000-0000-0000-0000-000000000000, which the
--   RLS policy from 0079 makes readable by every tenant. created_by/updated_by carry the
--   all-zero actor: these rows were written by a migration, not by a user, and inventing
--   a real user id in an audit column would be a lie.
--
-- Rollback:
--   DELETE FROM crm.stage_vocabulary
--     WHERE tenant_id = '00000000-0000-0000-0000-000000000000' AND governance = 'canonical';
--   The 0081 immutability trigger blocks that DELETE, so the rollback is:
--     ALTER TABLE crm.stage_vocabulary DISABLE TRIGGER trg_guard_canonical_stage_vocabulary_delete;
--     <the DELETE above>
--     ALTER TABLE crm.stage_vocabulary ENABLE TRIGGER trg_guard_canonical_stage_vocabulary_delete;
--
-- Affected services: crm-service (journeys module)
-- Sequencing: idempotent via ON CONFLICT DO NOTHING on (tenant_id, stage_code). Re-running
--   never updates an existing row, so a tenant's dashboards cannot shift under them.

INSERT INTO crm.stage_vocabulary
  (tenant_id, stage_code, display_name, description, ordinal, required, governance, created_by, updated_by)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'lead_captured', 'Lead Captured',
   'A prospect has been recorded from any channel. The entry measurement point of every journey.',
   10, true, 'canonical',
   '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000000', 'qualified', 'Qualified',
   'The prospect has been assessed as a genuine opportunity worth pursuing.',
   20, true, 'canonical',
   '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000000', 'proposed', 'Proposed',
   'A quotation or proposal has been issued to the prospect.',
   30, false, 'canonical',
   '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000000', 'agreed', 'Agreed',
   'The customer has accepted. The conversion measurement point funnels are compared on.',
   40, true, 'canonical',
   '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000000', 'onboarded', 'Onboarded',
   'Setup is complete and the customer is able to transact.',
   50, true, 'canonical',
   '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000000', 'active', 'Active',
   'The customer is transacting at the expected level.',
   60, false, 'canonical',
   '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000000', 'at_risk', 'At Risk',
   'Engagement or volume has fallen far enough to warrant a retention action.',
   70, false, 'canonical',
   '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000000', 'churned', 'Churned',
   'The relationship has ended. The exit measurement point of every journey.',
   80, false, 'canonical',
   '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000')
ON CONFLICT (tenant_id, stage_code) DO NOTHING;
