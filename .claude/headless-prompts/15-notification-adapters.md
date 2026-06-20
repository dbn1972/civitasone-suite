You are replacing notification channel stubs with production-ready adapters.
Read CLAUDE.md and `services/notification-service/src/adapters/`.

## Current state

Adapters in `email.ts`, `sms.ts`, `push.ts`, `whatsapp.ts`, `in_app.ts` log stub messages only.
Routes exist: `POST /notifications/send`, templates, campaigns, alert-rules.

## Goal

Implement real delivery for at least **email (SMTP)** and **in_app (Redis pub/sub or SSE hook)**.
Keep SMS/WhatsApp behind feature flags with clear "not configured" errors (not silent stubs).

## Environment variables

```
NOTIFICATION_EMAIL_DRIVER=smtp|ses|stub
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
NOTIFICATION_SMS_DRIVER=twilio|stub
REDIS_URL (for in_app fan-out)
```

## Rules

1. Adapter interface stays in `adapters/types.ts` — implement, don't rewrite routes.
2. Failed delivery → DLQ entry + audit event (existing outbox pattern).
3. Add integration test with Mailhog or memory transport for CI.
4. Update `packages/observability` metrics: `notification_delivery_total{channel,status}`.

## Deliverables

- Working SMTP email adapter
- In-app delivery via Redis channel `notifications:{tenantId}:{userId}`
- Remove `"stub send"` log-only paths from default code path
- Document env vars in `services/notification-service/.env.example`

## Verify

```bash
pnpm --filter @civitasone/notification-service test
curl -X POST http://localhost:8080/api/notification/notifications/send ...
```
