-- GAP-ADMIN-INVOICES-06: platform system template for invoice payment reminders, sent by
-- billing-service through the standard notification.send + templateId mechanism.
-- Fixed UUID -- must match SYSTEM_TEMPLATE_IDS.invoiceReminder in packages/events/src/notification.ts.
-- Platform-wide (zero tenant), same convention as 0003 / 0044 / 0049; idempotent.
DO $body$
BEGIN
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-000000000000', true);

  INSERT INTO templates.templates (id, tenant_id, channel, name, subject, body, status, created_by, updated_by)
  VALUES
    ('00000000-0000-4000-8001-00000000000e', '00000000-0000-0000-0000-000000000000', 'email', 'billing.invoice.reminder',
     'Payment reminder: invoice for {{period}}',
     'Dear {{name}}, this is a reminder that the invoice for {{period}} has {{outstanding}} outstanding. Please arrange payment, or contact your platform administrator if you have already paid.', 'active',
     '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099')
  ON CONFLICT (id) DO NOTHING;
END
$body$;
