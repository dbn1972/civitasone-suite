-- Workflow delegation notices: in-app + email system templates for the delegator and
-- the delegator's manager when a delegation is created or revoked (workflow-service).
-- Fixed UUIDs -- must match SYSTEM_TEMPLATE_IDS.workflowDelegation* in
-- packages/events/src/notification.ts. Platform-wide (zero tenant), same convention as
-- 0003 / 0044 / 0049 / 0050; idempotent. Dates in the body are pre-formatted in IST.
DO $body$
BEGIN
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-000000000000', true);

  INSERT INTO templates.templates (id, tenant_id, channel, name, subject, body, status, created_by, updated_by)
  VALUES
    ('00000000-0000-4000-8001-000000000010', '00000000-0000-0000-0000-000000000000', 'in_app', 'workflow.delegation.created',
     'Delegation created',
     '{{headline}} the role(s) {{roles}} to {{delegateName}}, effective {{period}} (IST).', 'active',
     '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
    ('00000000-0000-4000-8001-000000000011', '00000000-0000-0000-0000-000000000000', 'in_app', 'workflow.delegation.revoked',
     'Delegation revoked',
     '{{headline}} the delegation of role(s) {{roles}} to {{delegateName}} (was {{period}}, IST). Revoked on {{occurredAt}} IST.', 'active',
     '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
    ('00000000-0000-4000-8001-000000000012', '00000000-0000-0000-0000-000000000000', 'email', 'workflow.delegation.created.email',
     'Delegation created: {{roles}} to {{delegateName}}',
     'Dear colleague,\n\n{{headline}} the role(s) {{roles}} to {{delegateName}}, effective {{period}} (IST).\n\nIf this is unexpected, please contact your administrator.\n\nRegards,\nWorkflow', 'active',
     '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
    ('00000000-0000-4000-8001-000000000013', '00000000-0000-0000-0000-000000000000', 'email', 'workflow.delegation.revoked.email',
     'Delegation revoked: {{roles}} from {{delegateName}}',
     'Dear colleague,\n\n{{headline}} the delegation of role(s) {{roles}} to {{delegateName}} (was {{period}}, IST). Revoked on {{occurredAt}} IST.\n\nRegards,\nWorkflow', 'active',
     '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099')
  ON CONFLICT (id) DO NOTHING;
END
$body$;
