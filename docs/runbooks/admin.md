# Runbook: admin-service

> **Tier 2** | SLO: 99.9% availability, p95 read < 300 ms  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Platform Engineering | **Escalation:** SRE → CTO  
> **Slack:** `#incident-platform` | **PagerDuty:** `platform-ops`  

---

## Purpose

Platform administration control plane — tenant lifecycle management, module toggle, feature-flag management (platform-wide + per-tenant + kill switch), GDPR/DPDP data export, webhook management, backup scheduling, break-glass access (emergency admin elevation), scheduled-job management, custom domain registration, API key management, security/compliance dashboards, and tenant health monitoring. 18 modules. Owns `civitas_admin`.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_admin`) | `curl -s http://admin:3022/ready \| jq .checks.db` | Total outage |
| Redis (feature-flag cache) | `curl -s http://admin:3022/ready \| jq .checks.cache` | Stale feature flags (every request checks flags) |
| SQS/RabbitMQ | `curl -s http://admin:3022/ready \| jq .checks.queue` | Admin commands stop processing |
| Identity-service (tenant sync) | `curl -s http://identity:3001/health` | Tenant-identity sync fails |
| Install-service (provisioning) | `curl -s http://install:3005/health` | Tenant provisioning on create fails |
| Notification-service (webhooks) | `curl -s http://notification:3006/health` | Webhook delivery status not tracked |

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Admin Overview | `https://grafana.internal/d/admin-overview` | Tenant count, feature-flag status, job health |
| Feature Flags | `https://grafana.internal/d/admin-flags` | Flag activation rate, kill-switch history |
| Webhooks | `https://grafana.internal/d/admin-webhooks` | Delivery success rate, retry queue |
| Scheduled Jobs | `https://grafana.internal/d/admin-jobs` | Execution rate, failure count |

---

## Failure Modes

### FM-01: Feature-flag cache stale (flag toggle not reflecting)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | Manual report OR `admin_flag_cache_stale_seconds > 120` |
| **Impact** | Feature toggles not reflecting — could expose unreleased features or hide released ones |

**Triage:**

```
Feature flag not reflecting
├── Is Redis healthy?
│   → redis-cli -p 6381 PING
│   ├── Down → All flags served from stale cache or DB fallback
│   │   → Fix Redis. Flags will re-cache on next read.
│   └── Up → Check specific flag cache key
│       → redis-cli -p 6381 GET "admin:flag:{flagName}"
│       ├── Exists with old value → Cache invalidation didn't fire
│       │   → Check if flag-update consumer processed the change
│       │   → Force: redis-cli -p 6381 DEL "admin:flag:{flagName}"
│       └── Doesn't exist → Cache expired, will rebuild on next request
├── Was a kill-switch used?
│   → Kill-switch bypasses cache (direct DB check) — should be immediate
│   → If kill-switch isn't working → THIS IS A BUG. Escalate.
└── Is admin-worker processing flag updates?
    → curl -s http://admin-worker:3022/ops/heartbeat
```

**Commands:**

```bash
# Check Redis
redis-cli -p 6381 PING

# Check specific flag value in cache
redis-cli -p 6381 GET "admin:flag:{flagName}"

# Force-invalidate specific flag
redis-cli -p 6381 DEL "admin:flag:{flagName}"

# Force-invalidate ALL flags (causes brief latency spike)
redis-cli -p 6381 EVAL "for _,k in ipairs(redis.call('keys','admin:flag:*')) do redis.call('del',k) end" 0

# Check flag value in DB (source of truth)
psql civitas_admin -c "
  SELECT name, enabled, tenant_override, updated_at
  FROM admin.feature_flags
  WHERE name = '{flagName}';
"

# Activate kill-switch (bypasses cache — immediate effect)
curl -X POST http://admin:3022/v1/admin/feature-flags/{flagName}/kill \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false, "reason": "emergency_disable"}'
```

**Verification after fix:**

```bash
# Flag reads correctly from API
curl -s http://admin:3022/v1/admin/feature-flags/{flagName} \
  -H "Authorization: Bearer $TOKEN" | jq '.data.enabled'

# Cache key matches DB
redis-cli -p 6381 GET "admin:flag:{flagName}"
```

**Communication template:**

> 🟡 **[P1] Feature flag cache stale — toggle not reflecting**  
> Flag `{flagName}` shows {old_value} but should be {new_value}.  
> Root cause: {Redis issue | cache invalidation missed | worker stalled}.  
> Kill-switch available for emergency override. ETR: {5 min}.

---

### FM-02: Break-glass session not auto-closing

| Field | Value |
|-------|-------|
| **Severity** | P1 (SECURITY) |
| **Time to act** | < 10 min |
| **Alert** | `admin_breakglass_active_sessions` > expected |
| **Impact** | Emergency elevated access persisting beyond approved window |

**Triage:**

```
Break-glass session persisting
├── Check session TTL
│   → psql civitas_admin -c "SELECT id, user_id, expires_at, status
│      FROM admin.breakglass_sessions WHERE status = 'active';"
│   ├── Expired but still active → Closure event didn't fire
│   │   → Worker not processing scheduled close commands
│   │   → FIX: Manually close + restart worker
│   └── Not yet expired → Working as intended. Review actions.
├── Check admin-worker for scheduled job health
│   → curl -s http://admin-worker:3022/ops/heartbeat | jq '.scheduledJobs'
└── Review session activity via audit
    → All break-glass actions are audit-logged
    → curl -s "http://audit:3004/v1/audit/events?actor={userId}&since={sessionStart}"
```

**Commands:**

```bash
# List active break-glass sessions
psql civitas_admin -c "
  SELECT id, user_id, granted_at, expires_at, reason,
         NOW() - expires_at as overdue_by
  FROM admin.breakglass_sessions
  WHERE status = 'active'
  ORDER BY granted_at DESC;
"

# Manually close expired session
curl -X POST http://admin:3022/v1/admin/breakglass/{sessionId}/close \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "manual_expiry_enforcement"}'

# Review session actions in audit trail
curl -s "http://audit:3004/v1/audit/events?actor={userId}&since={grantedAt}" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'

# Restart worker to resume scheduled closures
docker restart civitasone-admin-worker
```

**Communication template:**

> 🟡 **[P1 — SECURITY] Break-glass session overdue for closure**  
> User {userId} elevated since {grantedAt}. Expected expiry: {expiresAt}.  
> Manual closure applied. Audit review of actions during session initiated.  
> Root cause: {worker stalled | scheduled close event lost}.

---

### FM-03: Webhook delivery permanently failing

| Field | Value |
|-------|-------|
| **Severity** | P3 |
| **Time to act** | < 1 hour |
| **Alert** | `admin_webhook_delivery_failure_rate > 20%` |
| **Impact** | Tenant integrations not receiving events — degraded external experience |

**Commands:**

```bash
# Check webhook delivery stats
curl -s http://admin:3022/ops/metrics | grep -E "webhook_delivery_success|webhook_delivery_failure"

# Find permanently failed webhooks
psql civitas_admin -c "
  SELECT w.id, w.url, w.tenant_id, w.status, w.last_failure_reason,
         w.consecutive_failures
  FROM admin.webhooks w
  WHERE w.status = 'failed'
  ORDER BY w.consecutive_failures DESC LIMIT 10;
"

# Test a specific webhook endpoint
curl -X POST http://admin:3022/v1/admin/webhooks/{webhookId}/test \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Reset a failed webhook (allows retries again)
curl -X POST http://admin:3022/v1/admin/webhooks/{webhookId}/reset \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

### FM-04: Scheduled job not firing

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `admin_scheduled_job_missed_execution` |
| **Impact** | Dependent service operations not triggered on schedule |

**Commands:**

```bash
# Check scheduled job status
psql civitas_admin -c "
  SELECT id, name, cron_expression, status, last_run_at, next_run_at,
         CASE WHEN next_run_at < NOW() THEN 'OVERDUE' ELSE 'OK' END as state
  FROM admin.scheduled_jobs
  ORDER BY next_run_at LIMIT 15;
"

# Check if job is paused
psql civitas_admin -c "SELECT id, name, status FROM admin.scheduled_jobs WHERE status = 'paused';"

# Check admin-worker health (scheduler runs here)
curl -s http://admin-worker:3022/ops/heartbeat | jq '.scheduledJobs'

# Force-run a specific job now
curl -X POST http://admin:3022/v1/admin/jobs/{jobId}/run-now \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Restart worker (recalculates all next-run times)
docker restart civitasone-admin-worker
```

---

### FM-05: Consumer stalled (admin-worker)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `admin_worker_heartbeat_stale > 60s` |
| **Impact** | All admin commands, scheduled jobs, flag updates stop |

**Commands:**

```bash
# Check worker heartbeat
curl -s http://admin-worker:3022/ops/heartbeat | jq .

# Restart worker
docker restart civitasone-admin-worker
kubectl rollout restart deployment/admin-worker -n civitasone

# Verify recovery
curl -s http://admin-worker:3022/ops/heartbeat | jq '.ageSeconds < 10'
```

---

## Rollback

```bash
# Docker
docker pull civitasone/admin-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d admin-service admin-worker

# K8s
kubectl set image deployment/admin-service \
  admin=civitasone/admin-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/admin-worker \
  worker=civitasone/admin-service:$PREVIOUS_TAG -n civitasone

# Force feature-flag cache rebuild
redis-cli -p 6381 EVAL "for _,k in ipairs(redis.call('keys','admin:flag:*')) do redis.call('del',k) end" 0

# Verify health
curl -s http://admin:3022/health | jq .
```

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh admin --target-time="2026-07-26T02:00:00Z"

# 2. Rebuild feature-flag cache
redis-cli -p 6381 EVAL "for _,k in ipairs(redis.call('keys','admin:flag:*')) do redis.call('del',k) end" 0

# 3. Verify tenants provisioned during gap
psql civitas_admin -c "
  SELECT id, status, created_at FROM admin.tenant_records
  WHERE created_at > '2026-07-26T01:45:00Z';
"

# 4. Recalculate scheduled-job next-run times
docker restart civitasone-admin-worker

# 5. Replay outbox
curl -X POST http://admin-worker:3022/ops/outbox-relay/replay-pending

# 6. Verify break-glass sessions are correctly closed
psql civitas_admin -c "
  SELECT id, status, expires_at FROM admin.breakglass_sessions
  WHERE status = 'active' AND expires_at < NOW();
"
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Admin service restored**  
> DB restored to {timestamp}. Feature-flag cache rebuilt.  
> Scheduled jobs recalculated. Break-glass sessions verified.  
> Platform control plane operational.
