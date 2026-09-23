-- System notification templates (fixed UUIDs for cross-service notification.send payloads)
-- tenant_id uses zero UUID for platform-wide templates

-- Idempotent under a second full bootstrap re-run: this seed relies on
-- running before RLS is enabled later in this file/sequence (see the
-- comment above), which is only true the FIRST time it is applied. On a
-- re-run against an already-migrated cluster, RLS is already active and
-- this session never otherwise sets app.tenant_id, so WITH CHECK would
-- reject this row regardless of ON CONFLICT (Postgres evaluates WITH CHECK
-- on the candidate row before conflict resolution). Wrapped in a DO block using set_config('app.tenant_id', ..., true) --
-- SET LOCAL semantics (transaction-scoped to the DO block's own
-- implicit transaction under psql's per-statement autocommit), not a
-- raw session-scoped SET. This fleet routes through PgBouncer in
-- transaction-pooling mode (PERF-001): a raw SET leaves the GUC on the
-- shared backend connection for whichever unrelated client the pool
-- hands it to next -- a cross-tenant leak for a tenant-scoping GUC. See
-- scripts/ci/raw-session-guc-guard.mjs and the identical pattern in
-- services/audit-service/migrations/0025_fix_legacy_status_values.sql.
DO $body$
BEGIN
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-000000000000', true);

INSERT INTO templates.templates (id, tenant_id, channel, name, subject, body, status, created_by, updated_by)
VALUES
  ('00000000-0000-4000-8001-000000000000', '00000000-0000-0000-0000-000000000000', 'in_app', 'default', 'Notification', '{{message}}', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4000-8001-000000000001', '00000000-0000-0000-0000-000000000000', 'email', 'audit.para.issued', 'Audit Para Issued: {{paraNo}}',
   'Audit para {{paraNo}} has been issued to your department. Para ID: {{paraId}}', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4000-8001-000000000002', '00000000-0000-0000-0000-000000000000', 'email', 'legal.case.date_set', 'Court Hearing: {{nextDate}}',
   'Next hearing for case {{caseId}} is scheduled on {{nextDate}}.', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4000-8001-000000000003', '00000000-0000-0000-0000-000000000000', 'email', 'citizen.rti.filed', 'RTI Filed',
   'RTI request {{rtiId}} filed. Deadline: {{deadline}}', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4000-8001-000000000004', '00000000-0000-0000-0000-000000000000', 'sms', 'citizen.application.approved', 'Application Approved',
   'Your application {{applicationId}} has been approved.', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4000-8001-000000000005', '00000000-0000-0000-0000-000000000000', 'email', 'citizen.application.sla_breached', 'SLA Breach Alert',
   'Application {{applicationId}} has exceeded SLA.', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4000-8001-000000000006', '00000000-0000-0000-0000-000000000000', 'sms', 'citizen.grievance.resolved', 'Grievance Resolved',
   'Your grievance {{grievanceId}} has been resolved.', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4000-8001-000000000007', '00000000-0000-0000-0000-000000000000', 'email', 'citizen.grievance.escalated', 'Grievance Escalated',
   'Grievance {{grievanceId}} has been escalated.', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4000-8001-000000000008', '00000000-0000-0000-0000-000000000000', 'sms', 'grant.application.approved', 'Grant Approved',
   'Your grant application {{applicationId}} has been approved for {{amountApprovedMinor}} paise.', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4000-8001-000000000009', '00000000-0000-0000-0000-000000000000', 'sms', 'grant.disbursement.completed', 'Disbursement Complete',
   'Grant disbursement {{disbursementId}} completed.', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4000-8001-00000000000a', '00000000-0000-0000-0000-000000000000', 'email', 'grant.disbursement.failed', 'Disbursement Failed',
   'Grant disbursement {{disbursementId}} failed. Contact admin.', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4000-8001-00000000000b', '00000000-0000-0000-0000-000000000000', 'email', 'procurement.vendor.blacklisted', 'Vendor Blacklisted',
   'Vendor {{vendorId}} has been blacklisted.', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4000-8001-00000000000c', '00000000-0000-0000-0000-000000000000', 'email', 'estab.rti.created', 'RTI CPIO Intake',
   'RTI {{rtiId}} assigned. Deadline: {{deadline}}', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099')
ON CONFLICT (id) DO NOTHING;

END
$body$;
