# Runbook: notification-service

> **Tier 2** (candidate for Tier 1) | SLO: 99.9% availability, delivery p95 < 5s, DLQ = 0 for critical channels  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Platform Engineering | **Escalation:** SRE → Product  
> **Slack:** `#incident-notification` | **PagerDuty:** `notification-critical`  

---

## Purpose

Multi-channel notification delivery hub — email (SES/SMTP), SMS (MSG91/Kaleyra), push (FCM), in-app inbox, webhook. Template management with i18n variants, scheduling/digest batching, DND windows, campaign bulk-send, delivery analytics, and approval workflow for sensitive templates. Owns `civitas_notification`. Highest-throughput consumer in the fleet (every service publishes `NOTIFICATION_SEND`).

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_notification`) | `curl -s http://notification:3006/ready \| jq .checks.db` | Total outage |
| Redis | `curl -s http://notification:3006/ready \| jq .checks.cache` | Rate limiting + dedup broken |
| SQS/RabbitMQ | `curl -s http://notification:3006/ready \| jq .checks.queue` | Delivery stops |
| SES (email) | `curl -s http://notification:3006/ops/channel-health \| jq .email` | Email channel dead |
| SMS provider | `curl -s http://notification:3006/ops/channel-health \| jq .sms` | SMS channel dead |
| FCM (push) | `curl -s http://notification:3006/ops/channel-health \| jq .push` | Push channel dead |

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Notification Overview | `https://grafana.internal/d/notification-overview` | Delivery rate, failure rate, channel breakdown |
| Channel Health | `https://grafana.internal/d/notification-channels` | Per-channel success rate, latency |
| DLQ Monitor | `https://grafana.internal/d/notification-dlq` | DLQ depth, failed deliveries |
| Campaign Monitor | `https://grafana.internal/d/notification-campaigns` | Campaign throughput, delivery progress |

---

## Failure Modes

### FM-01: Email delivery failing (SES bounce/complaint rate high)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `notification_email_failure_rate > 5%` |
| **Impact** | Email notifications not reaching users |

**Triage:**

```
Email delivery failing
├── Check SES bounce rate
│   → AWS Console: SES → Reputation Dashboard
│   ├── Bounce rate > 5% → SES may throttle/suspend sending identity
│   │   → Stop sending to bounced addresses immediately
│   │   → Mark permanent bounces in DB: status = 'permanently_failed'
│   │   → DO NOT retry bounced addresses (damages sender reputation)
│   └── Bounce rate normal → Check specific error
│       → curl -s http://notification:3006/ops/channel-health | jq '.email'
│       ├── "SMTP_TIMEOUT" → SES endpoint unreachable (network issue)
│       ├── "AUTHENTICATION_FAILED" → SES credentials expired/rotated
│       │   → Check: AWS_SES_ACCESS_KEY_ID and AWS_SES_SECRET env vars
│       └── "RATE_LIMITED" → Sending too fast for SES limits
│           → Service rate-limiter should handle this. Check Redis rate-limit keys.
├── Check FROM_EMAIL domain
│   → Verify DKIM/SPF/DMARC records are valid
│   → dig TXT _dmarc.civitasone.example.com
```

**Commands:**

```bash
# Check email channel health
curl -s http://notification:3006/ops/channel-health | jq '.email'

# Check recent delivery failures
psql civitas_notification -c "
  SELECT error_code, COUNT(*) FROM notification.deliveries
  WHERE channel = 'email' AND status = 'failed'
  AND attempted_at > NOW() - INTERVAL '1 hour'
  GROUP BY error_code ORDER BY count DESC LIMIT 10;
"

# Check bounce list (permanently failed emails)
psql civitas_notification -c "
  SELECT COUNT(*) FROM notification.deliveries
  WHERE channel = 'email' AND status = 'permanently_failed'
  AND attempted_at > NOW() - INTERVAL '24 hours';
"

# Test email delivery manually
curl -X POST http://notification:3006/ops/test-delivery \
  -H "Content-Type: application/json" \
  -d '{"channel": "email", "to": "test@example.com", "subject": "Health Check", "body": "Test"}'
```

---

### FM-02: SMS provider rate-limited

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `notification_sms_failure_rate > 10%` |
| **Impact** | OTP/critical SMS not reaching users |

**Commands:**

```bash
# Check SMS channel health
curl -s http://notification:3006/ops/channel-health | jq '.sms'

# Check rate-limit counter in Redis
redis-cli -p 6381 GET "notification:sms:rate:global"
redis-cli -p 6381 TTL "notification:sms:rate:global"

# If rate-limit key is corrupted, clear it (limiter rebuilds)
redis-cli -p 6381 DEL "notification:sms:rate:global"

# Check SMS provider API directly (if credentials available)
# MSG91 status: https://api.msg91.com/api/report.php

# Check delivery attempts
psql civitas_notification -c "
  SELECT error_code, COUNT(*) FROM notification.deliveries
  WHERE channel = 'sms' AND status = 'failed'
  AND attempted_at > NOW() - INTERVAL '1 hour'
  GROUP BY error_code;
"
```

---

### FM-03: DLQ on `notification.send` (main inbound topic)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 15 min |
| **Alert** | `notification_dlq_depth{topic="notification.send"} > 0` |
| **Impact** | Cross-platform notification delivery stopped |

**Triage:**

```
notification.send DLQ
├── Read error from DLQ message
│   → curl -s http://notification-worker:3006/ops/dlq/peek?topic=notification.send&limit=5 | jq '.[0].error'
│   ├── "TEMPLATE_NOT_FOUND"
│   │   → Source service referenced a templateCode that doesn't exist
│   │   → Check: psql civitas_notification -c "SELECT code FROM notification.templates WHERE code = '<code>';"
│   │   → FIX: Create the template OR fix the publisher's template reference
│   │   → DO NOT redrive until template exists (will just DLQ again)
│   ├── "MISSING_TEMPLATE_VARS" (interpolation failure)
│   │   → Payload missing required variables for the template
│   │   → FIX: Fix upstream publisher to include all required vars
│   ├── "CHANNEL_NOT_CONFIGURED" (tenant has no email/SMS configured)
│   │   → Tenant hasn't set up notification channels
│   │   → FIX: Configure channel for tenant via admin, then redrive
│   └── "DB_ERROR" / transient
│       → Safe to redrive once DB is healthy
```

**Commands:**

```bash
# Peek DLQ
curl -s http://notification-worker:3006/ops/dlq/peek?topic=notification.send&limit=10 | jq '.'

# Group DLQ by error type
curl -s http://notification-worker:3006/ops/dlq/peek?limit=100 | jq '.[].error' | sort | uniq -c | sort -rn

# Redrive (after fixing root cause)
curl -X POST http://notification-worker:3006/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "notification.send", "batchSize": 50}'

# Check inbound throughput (should be 200-500 events/sec at peak)
curl -s http://notification:3006/ops/metrics | grep notification_inbound_total
```

---

### FM-04: Digest flush not triggering

| Field | Value |
|-------|-------|
| **Severity** | P3 |
| **Time to act** | < 1 hour |
| **Alert** | `notification_digest_last_flush_seconds > 86400` (> 24h) |
| **Impact** | Users with digest preferences don't receive batched summaries |

**Commands:**

```bash
# Check digest scheduled job
curl -s http://notification-worker:3006/ops/scheduled-jobs | jq '.[] | select(.name | contains("digest"))'

# Manually trigger digest flush
curl -X POST http://notification-worker:3006/ops/digest/flush

# Check pending digest entries
psql civitas_notification -c "
  SELECT tenant_id, COUNT(*) FROM notification.digest_buffer
  WHERE flushed_at IS NULL
  GROUP BY tenant_id;
"
```

---

## Rollback

```bash
docker pull civitasone/notification-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d notification-service notification-worker

curl -s http://notification:3006/health | jq .
```

Template content is versioned in DB — rollback doesn't revert template text.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh notification --target-time="<timestamp>"

# 2. Replay outbox
curl -X POST http://notification-worker:3006/ops/outbox-relay/replay-pending

# 3. Note: some notifications may be re-sent (duplicates)
# This is acceptable for informational messages.
# Transactional notifications are protected by idempotency key.

# 4. Check delivery pipeline is flowing
watch -n5 'curl -s http://notification:3006/ops/metrics | grep notification_delivered_total'

# 5. Verify no permanent-failure records were lost
psql civitas_notification -c "
  SELECT channel, COUNT(*) FROM notification.deliveries
  WHERE status = 'permanently_failed' GROUP BY channel;
"
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Notification service restored**  
> DB restored to {timestamp}. Delivery pipeline active. Some users may receive duplicate informational notifications (harmless).  
> Critical channels (SMS/email): verified operational.

**Capacity note:** notification-service is the highest-throughput consumer. At 1000 TPS, expect 200–500 notification events/sec at peak. Scale the notification-worker horizontally as the primary lever:

```bash
# Scale workers (K8s)
kubectl scale deployment/notification-worker --replicas=3 -n civitasone
```
