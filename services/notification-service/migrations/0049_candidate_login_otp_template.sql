-- GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-03: email template for the careers-portal
-- candidate sign-in code. Before this, the OTP was only ever echoed in non-production
-- responses and never delivered, so a production candidate could not sign in.
-- Fixed UUID -- must match SYSTEM_TEMPLATE_IDS.candidateLoginOtp in
-- packages/events/src/notification.ts. Platform-wide (zero tenant), same convention as
-- 0003 / 0044; idempotent (ON CONFLICT DO NOTHING).
DO $body$
BEGIN
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-000000000000', true);

  INSERT INTO templates.templates (id, tenant_id, channel, name, subject, body, status, created_by, updated_by)
  VALUES
    ('00000000-0000-4000-8001-00000000000d', '00000000-0000-0000-0000-000000000000', 'email', 'hrms.candidate.login_otp', 'Your sign-in code',
     'Your one-time sign-in code for the Candidate Portal is {{code}}. It expires in {{expiresInMinutes}} minutes. If you did not request it, you can ignore this email.', 'active',
     '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099')
  ON CONFLICT (id) DO NOTHING;
END
$body$;
