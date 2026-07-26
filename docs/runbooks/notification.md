# Runbook: notification-service

> Tier 2 (candidate for Tier 1 promotion). Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, notification delivery p95 < 5s (email/SMS), DLQ = 0 for critical channels.

- **Purpose:** multi-channel notification delivery (email, SMS, push, in-app inbox, webhook), template management with i18n variants, scheduling/digest batching, DND windows, campaign bulk-send, delivery analytics (open/click tracking), and approval workflow for sensitive templates. Owns `civitas_notification`. The fan-out hub — every other service publishes `NOTIFICATION_SEND` events that land here.

- **Owner / escalation:** primary: Platform Engineering (notification is cross-cutting). Secondary: SRE. Page on delivery failure rate > 5% (citizens/employees stop receiving time-sensitive alerts — SLA breach notifications, payment confirmations, hearing dates).

- **Dependencies:**
  - Own Postgres DB (`civitas_notification`), RLS enabled, tenant-scoped.
  - Redis — delivery deduplication, rate limiting per channel, DND window lookups, digest accumulation buffer.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for template CRUD, send, schedule, campaign, digest flush, webhook delivery, DND, i18n, segments, approval; events for delivery success/failure/permanent-failure.
  - External channel providers (env-gated, circuit-breaker wrapped):
    - Email: SES / SMTP relay (`EMAIL_PROVIDER`, `SMTP_HOST`)
    - SMS: MSG91 / Kaleyra / generic HTTP gateway (`SMS_PROVIDER`)
    - Push: FCM (`FCM_SERVER_KEY`)
    - Webhook: tenant-configured HTTP endpoints
  - Cross-service consumed: `NOTIFICATION_SEND` (published by every service via `@civitasone/events`). This is the highest-volume inbound topic in the platform.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: delivery rate by channel (email/SMS/push/webhook), failure rate by provider, p95 delivery latency, DLQ depth, campaign throughput, digest flush lag.
  - Alert: delivery failure rate > 5% = WARN, > 15% = CRITICAL; DLQ > 0 on `notification.send` = immediate investigation; SMS provider latency > 10s = WARN.

- **Common failure modes → action:**
  - *Email delivery failing (SES bounce/complaint rate high)* → check SES dashboard for bounce rate; if > 5%, SES may have throttled the sending identity. Verify `FROM_EMAIL` domain has valid DKIM/SPF. Do NOT retry bounced addresses — mark them as permanently failed to protect sender reputation.
  - *SMS provider rate-limited* → MSG91/Kaleyra impose per-second rate limits; the service's built-in rate limiter should absorb spikes. If DLQ fills, check if the rate-limit Redis key (`notification:sms:rate:{tenantId}`) is corrupted. Clear the key and let the limiter rebuild.
  - *DLQ on `notification.send`* → most common cause: malformed template variable interpolation (a service published a payload missing required template vars). Fix: identify the source event, correct the publisher, redrive after fix.
  - *Digest flush not triggering* → verify the scheduled `notification.digest.flush` command fires at configured intervals (hourly/daily per tenant DND + digest rules). Check admin-service scheduled-jobs.
  - *Webhook delivery permanent failure* → after 3 retries with exponential backoff, webhook endpoints are marked `permanently_failed`. To re-enable: tenant admin must update the endpoint URL or acknowledge the failure via the webhook management UI.
  - *Campaign sending slowly* → campaigns use batch publishing (1000 recipients/batch). Check consumer concurrency settings; verify Redis is not under memory pressure (campaign segment resolution is cached).
  - *Template approval stuck* → approval workflow instance may be in `suspended` state. Check workflow-service for the instance; ensure the approver role has an assigned officer.

- **Rollback:** redeploy previous image tag. Template content is versioned — rolling back code does not revert template text (those are DB rows). If a bad template was published, use the template management UI to revert to the previous version.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. Notification delivery is best-effort after restore — some notifications may be re-sent (recipients see duplicates, which is acceptable for informational messages). For transactional notifications (payment confirmations), the idempotency key prevents duplicate sends if the consumer replays.

- **Capacity note:** notification-service is the highest-throughput consumer in the fleet. At 1000 TPS platform-wide, expect 200–500 notification events/sec at peak (approval chains, bulk imports, SLA sweeps all generate notifications). Horizontal scaling of the notification worker is the primary lever.
