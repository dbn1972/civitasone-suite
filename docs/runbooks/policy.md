# Runbook: policy-service

> **Tier 0** | SLO: 99.95% availability, p95 evaluate < 10 ms, zero false-permits  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Security Engineering | **Escalation:** Security → SRE → CTO  
> **Slack:** `#incident-policy` | **PagerDuty:** `platform-critical`  

---

## Purpose

Centralized RBAC/ABAC policy engine — role management, permission assignment, policy binding (user-to-role), policy evaluation (called on every request by gateway/services), ABAC rule engine (time-of-day, IP, department, classification), role-feature grants, and break-glass emergency access. Owns `civitas_policy`. The evaluate endpoint is the most latency-sensitive in the platform — every HTTP request passes through it.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_policy`) | `curl -s http://policy:3003/ready \| jq .checks.db` | Policy evaluation falls back to cache (if cache hit), otherwise total auth failure |
| Redis (policy cache) | `curl -s http://policy:3003/ready \| jq .checks.cache` | CATASTROPHIC: all evaluations hit DB (won't scale at 1000 TPS) |
| SQS/RabbitMQ | `curl -s http://policy:3003/ready \| jq .checks.queue` | Binding changes stop processing (stale access) |
| Gateway (hot-path caller) | `curl -s http://gateway:8080/health` | Authorization calls not made (fail-open risk) |
| Identity-service (binding source) | `curl -s http://identity:3001/health` | New user bindings not propagating |

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Policy Overview | `https://grafana.internal/d/policy-overview` | Evaluate rate, p50/p95/p99 latency, deny rate |
| Cache Performance | `https://grafana.internal/d/policy-cache` | Hit ratio (must be > 95%), eviction rate |
| ABAC/Break-Glass | `https://grafana.internal/d/policy-abac` | ABAC rule evaluations, break-glass sessions |
| Binding Activity | `https://grafana.internal/d/policy-bindings` | Bind/revoke volume, bulk import status |

---

## Failure Modes

### FM-01: Evaluation latency spike (platform-wide cascade)

| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **Time to act** | IMMEDIATE (< 2 min) |
| **Alert** | `policy_evaluate_duration_seconds{quantile="0.95"} > 0.05` |
| **Impact** | Every request platform-wide slows — gateway calls policy on every proxied request |

**Triage:**

```
Evaluation latency spike
├── Check Redis (policy cache)
│   → redis-cli -p 6381 PING
│   ├── Redis down/unreachable → CATASTROPHIC at 1000 TPS
│   │   → Every evaluation hits Postgres directly
│   │   → FIX REDIS IMMEDIATELY (this is the #1 priority)
│   │   → docker restart civitasone-redis OR fix network
│   └── Redis up → Check cache hit ratio
│       → curl -s http://policy:3003/ops/metrics | grep cache_hit_ratio
│       ├── Hit ratio < 90% → Mass cache invalidation event
│       │   → Was there a bulk binding create/revoke?
│       │   → Cache will warm in < 60s. Monitor.
│       │   → If sustained: check Redis eviction (memory pressure)
│       └── Hit ratio > 95% → DB latency issue
│           → psql civitas_policy -c "SELECT * FROM pg_stat_activity
│              WHERE state='active' AND query_start < NOW() - INTERVAL '10ms';"
│           ├── Many active queries → Connection pool exhaustion
│           └── Few but slow → Index issue or lock contention
├── Was there a recent deployment?
│   → New ABAC rules or complex bindings can increase eval time
│   → Rollback if p95 doesn't recover in 5 min
└── DDoS / abnormal request pattern?
    → Check gateway rate-limit metrics for unusual traffic
```

**Commands:**

```bash
# Check Redis connectivity (TOP PRIORITY)
redis-cli -p 6381 PING

# Check cache hit ratio
curl -s http://policy:3003/ops/metrics | grep -E "cache_hit_ratio|cache_miss_total"

# Check Redis memory (evictions = problem)
redis-cli -p 6381 INFO memory | grep -E "used_memory_human|maxmemory_human"
redis-cli -p 6381 INFO stats | grep evicted_keys

# Check evaluation latency breakdown
curl -s http://policy:3003/ops/metrics | grep policy_evaluate_duration

# Check DB connection pool
curl -s http://policy:3003/ops/metrics | grep -E "db_pool_size|db_pool_used"

# Check active DB queries
psql civitas_policy -c "
  SELECT pid, NOW() - query_start AS duration, left(query, 100)
  FROM pg_stat_activity
  WHERE state = 'active' AND datname = 'civitas_policy'
  ORDER BY duration DESC LIMIT 10;
"

# Emergency: force cache warm-up (rebuilds all binding caches)
curl -X POST http://policy:3003/ops/cache-rebuild
```

**Verification after fix:**

```bash
# p95 back under 10ms
curl -s http://policy:3003/ops/metrics | grep 'policy_evaluate_duration.*quantile="0.95"'

# Cache hit ratio > 95%
curl -s http://policy:3003/ops/metrics | grep cache_hit_ratio

# Gateway overall latency recovered
curl -s http://gateway:8080/ops/metrics | grep gateway_http_request_duration
```

**Communication template:**

> 🔴 **[P0] Policy evaluation latency spike — platform-wide slowdown**  
> p95: {X}ms (target: 10ms). Root cause: {Redis down | cache invalidation storm | DB latency}.  
> Every HTTP request impacted (gateway evaluates policy on all requests).  
> ETR: {2 min for Redis fix | 5 min for cache warm-up}.

---

### FM-02: Cache stale after binding revocation (SECURITY)

| Field | Value |
|-------|-------|
| **Severity** | P0 (SECURITY) |
| **Time to act** | IMMEDIATE |
| **Alert** | Manual detection OR `policy_binding_revoke_cache_miss` |
| **Impact** | Revoked user STILL HAS ACCESS — security breach |

**Triage:**

```
Revoked user still has access
├── Check if revocation event was processed
│   → curl -s http://policy-worker:3003/ops/consumer-status | jq .
│   ├── Event not yet processed → Worker lag or DLQ
│   │   → Check worker heartbeat
│   │   → Check DLQ for revocation events
│   └── Event processed → Cache invalidation failed
│       → Check if the specific cache key was deleted
│       → redis-cli -p 6381 EXISTS "policy:binding:{userId}:{tenantId}"
│       ├── Key still exists → Cache invalidation bug (P0)
│       │   → IMMEDIATE: manually delete the key
│       │   → redis-cli -p 6381 DEL "policy:binding:{userId}:{tenantId}"
│       └── Key deleted → Cache was rebuilt from stale DB? Race condition?
│           → Force full cache rebuild for this tenant
└── Is it a TTL issue? (cache serving stale data within TTL window)
    → Security-critical revocations MUST invalidate immediately (not TTL-based)
    → If relying on TTL for revocations → THIS IS A BUG. File P0.
```

**Commands:**

```bash
# Check if binding exists in DB (should be revoked/deleted)
psql civitas_policy -c "
  SELECT user_id, role_id, status, revoked_at
  FROM policy.bindings
  WHERE user_id = '{userId}' AND tenant_id = '{tenantId}';
"

# Check if cache key still exists (should NOT after revocation)
redis-cli -p 6381 EXISTS "policy:binding:{userId}:{tenantId}"

# EMERGENCY: Force-delete stale cache key
redis-cli -p 6381 DEL "policy:binding:{userId}:{tenantId}"

# Verify user is now denied
curl -s -X POST http://policy:3003/v1/policy/evaluate \
  -H "Content-Type: application/json" \
  -d '{"userId":"{userId}","tenantId":"{tenantId}","resource":"*","action":"*"}' | jq '.data.decision'

# Check worker processed the revocation
docker logs civitasone-policy-worker --since=30m 2>&1 | grep "revoke" | grep "{userId}"

# Nuclear option: flush all policy cache for tenant (causes latency spike but ensures security)
redis-cli -p 6381 EVAL "for _,k in ipairs(redis.call('keys','policy:*:{tenantId}:*')) do redis.call('del',k) end" 0
```

**Communication template:**

> 🔴 **[P0 — SECURITY] Stale policy cache — revoked access still active**  
> User {userId} still has access after binding revocation. Cache invalidation failed.  
> IMMEDIATE action: manual cache key deletion applied.  
> Root cause investigation required. No data breach confirmed yet.

---

### FM-03: Break-glass session not expiring

| Field | Value |
|-------|-------|
| **Severity** | P1 (SECURITY) |
| **Time to act** | < 10 min |
| **Alert** | `policy_breakglass_sessions_active` > expected OR manual report |
| **Impact** | Emergency elevated access persisting beyond approved window |

**Triage:**

```
Break-glass session persisting
├── Check session TTL
│   → psql civitas_policy -c "SELECT * FROM policy.breakglass_sessions
│      WHERE status='active' AND expires_at < NOW();"
│   ├── Expired but still active → Expiry event didn't fire
│   │   → FIX: Manually expire via command
│   └── Not yet expired → Working as intended
├── Check if expiry worker/scheduler is running
│   → curl -s http://policy-worker:3003/ops/heartbeat
└── Review session's actions (audit trail)
    → curl -s "http://audit:3004/v1/audit/events?actor={userId}&since={breakglassStart}"
```

**Commands:**

```bash
# List active break-glass sessions
psql civitas_policy -c "
  SELECT id, user_id, role_id, granted_at, expires_at, reason
  FROM policy.breakglass_sessions
  WHERE status = 'active'
  ORDER BY granted_at DESC;
"

# Manually revoke an expired break-glass session
curl -X POST http://policy:3003/v1/policy/breakglass/revoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"sessionId": "{sessionId}", "reason": "manual_expiry_enforcement"}'

# Invalidate the associated cache
redis-cli -p 6381 DEL "policy:breakglass:{userId}:{tenantId}"

# Verify session is now inactive
psql civitas_policy -c "SELECT status FROM policy.breakglass_sessions WHERE id = '{sessionId}';"
```

**Communication template:**

> 🟡 **[P1 — SECURITY] Break-glass session persisting beyond TTL**  
> User {userId} elevated access since {timestamp}. Expected expiry: {expiresAt}.  
> Manual revocation applied. Audit review of actions during session initiated.  
> Root cause: {expiry scheduler stalled | event not fired}.

---

### FM-04: Consumer stalled (policy-worker)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `policy_worker_heartbeat_stale > 60s` |
| **Impact** | New role bindings, ABAC rules, revocations not processing — stale access state |

**Commands:**

```bash
# Check worker heartbeat
curl -s http://policy-worker:3003/ops/heartbeat | jq .

# Check consumer status
curl -s http://policy-worker:3003/ops/consumer-status | jq '.lastProcessedAt'

# View recent logs
docker logs civitasone-policy-worker --tail=100 --since=5m 2>&1 | grep -E "ERROR|FATAL"

# Restart worker (Docker)
docker restart civitasone-policy-worker

# Restart worker (K8s)
kubectl rollout restart deployment/policy-worker -n civitasone

# Check DLQ for stuck messages
curl -s http://policy-worker:3003/ops/dlq/peek?limit=5 | jq .
```

**Verification after fix:**

```bash
# Heartbeat fresh
curl -s http://policy-worker:3003/ops/heartbeat | jq '.ageSeconds < 10'

# Binding changes flowing
curl -s http://policy:3003/ops/metrics | grep policy_bindings_processed_total
```

---

### FM-05: Bulk binding import failing (LDAP/AD sync)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `policy_bulk_import_failure_total` increasing |
| **Impact** | New users from directory sync don't get correct roles |

**Commands:**

```bash
# Check DLQ for import failures
curl -s http://policy-worker:3003/ops/dlq/peek?topic=policy.binding.bulk_import | jq .

# Common cause: duplicate binding (user already has role)
psql civitas_policy -c "
  SELECT user_id, role_id, tenant_id, COUNT(*)
  FROM policy.bindings
  GROUP BY user_id, role_id, tenant_id
  HAVING COUNT(*) > 1;
"

# Check import job status
curl -s http://policy:3003/ops/metrics | grep bulk_import

# Retry failed batch (duplicates are safely rejected by unique constraint)
curl -X POST http://policy-worker:3003/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "policy.binding.bulk_import", "batchSize": 50}'
```

---

## Rollback

```bash
# Docker
docker pull civitasone/policy-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d policy-service policy-worker

# K8s
kubectl set image deployment/policy-service \
  policy=civitasone/policy-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/policy-worker \
  worker=civitasone/policy-service:$PREVIOUS_TAG -n civitasone

# IMMEDIATELY after rollback: rebuild policy cache
curl -X POST http://policy:3003/ops/cache-rebuild

# Verify health
curl -s http://policy:3003/health | jq .
```

**CAUTION:** Policy rollback can change who has access to what. If a role/permission was added in the rolled-back version, users will lose access. Coordinate with affected teams before rollback.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** < 15 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh policy --target-time="2026-07-26T02:00:00Z"

# 2. IMMEDIATELY: Force-rebuild entire policy cache in Redis
curl -X POST http://policy:3003/ops/cache-rebuild

# 3. Verify no permissions granted during gap that should have been denied
psql civitas_policy -c "
  SELECT user_id, role_id, granted_at
  FROM policy.bindings
  WHERE granted_at > '2026-07-26T01:45:00Z'
  ORDER BY granted_at;
"

# 4. Cross-reference with audit log
curl -s "http://audit:3004/v1/audit/events?service=policy&since=2026-07-26T01:45:00Z" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'

# 5. Confirm break-glass sessions that expired during gap are closed
psql civitas_policy -c "
  SELECT id, user_id, expires_at FROM policy.breakglass_sessions
  WHERE status = 'active' AND expires_at < NOW();
"

# 6. Replay outbox
curl -X POST http://policy-worker:3003/ops/outbox-relay/replay-pending

# 7. Verify evaluation working
curl -s -X POST http://policy:3003/v1/policy/evaluate \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","tenantId":"test","resource":"test","action":"read"}' | jq '.data.decision'
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Policy service restored**  
> DB restored to {timestamp}. Full policy cache rebuilt.  
> Access audit verified — no unauthorized grants during gap.  
> Break-glass sessions cleaned. Evaluation latency nominal.
