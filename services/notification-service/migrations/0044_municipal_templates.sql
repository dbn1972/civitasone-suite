-- Municipal Sec5 notification templates (17 services: advertisement, vendor,
-- sewerage, shop, trade, animal, fire, crematorium, drainage, event, parking,
-- parks, roadcut, building, refund, market, swm).
--
-- Fixes the gap where packages/events/src/notification.ts's
-- buildNotificationPayload fell back to the generic `default` template for
-- every municipal cross-event type because only citizen.application.approved
-- was mapped. Event types match MUNICIPAL_EVENT_TYPES in
-- packages/events/src/municipal-cross.ts. Fixed UUIDs — must match
-- SYSTEM_TEMPLATE_IDS in packages/events/src/notification.ts.
--
-- tenant_id uses zero UUID for platform-wide templates (same convention as
-- 0003_system_templates.sql).

-- RLS on templates.templates (migrations 0006/0007) is FORCE'd even for
-- the owning role, keyed on the same app.tenant_id GUC 0003_system_templates.sql
-- relied on running before RLS existed. These are platform-wide templates
-- (tenant_id = zero UUID), so claim that tenant for this migration session
-- — mirrors 0069_platform_bypass_read_policy.sql's app.* GUC convention.
SET app.tenant_id = '00000000-0000-0000-0000-000000000000';

INSERT INTO templates.templates (id, tenant_id, channel, name, subject, body, status, created_by, updated_by)
VALUES
  ('00000000-0000-4000-8002-000000000001', '00000000-0000-0000-0000-000000000000', 'sms', 'municipal.application.submitted', 'Application Submitted',
   'Your application {{applicationId}} for {{serviceName}} has been submitted. We will notify you of any updates.', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4000-8002-000000000002', '00000000-0000-0000-0000-000000000000', 'email', 'municipal.fee.due', 'Fee Payment Due',
   'A fee of {{amountMinor}} paise is due for application {{applicationId}}. Challan: {{challanNo}}.', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4000-8002-000000000003', '00000000-0000-0000-0000-000000000000', 'sms', 'municipal.status.changed', 'Application Status Update',
   'Your application {{applicationId}} status changed to {{status}}.', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-4000-8002-000000000004', '00000000-0000-0000-0000-000000000000', 'email', 'municipal.permit.issued', 'Permit Issued',
   'Your permit {{permitNo}} for application {{applicationId}} has been issued.', 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099')
ON CONFLICT (id) DO NOTHING;
