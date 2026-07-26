# Runbook: tenant-service

> **Tier 0** | SLO: 99.95% availability, p95 read < 200 ms, tenant isolation guarantee 100%  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Platform Engineering | **Escalation:** SRE → CTO  
> **Slack:** `#incident-platform` | **PagerDuty:** `platform-critical`  

---

## Purpose

Tenant registry and lifecycle — creation/update/suspension/onboarding, plan management (feature tiers), subscription lifecycle, org-hierarchy (departments/divisions), quota management (storage, users, API rate limits per plan), tenant settings (timezone, locale, branding), data-migration tooling, and isolation mode configuration (shared-DB RLS vs silo). Every service resolves tenant config on each request. Owns `civitas_tenant`.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_tenant`) | `curl -s http://tenant:3002/ready \| jq .checks.db` | Total outage — no tenant resolution |
| Redis (tenant config cache) | `curl -s http://tenant:3002/ready \| jq .checks.cache` | Every service hits DB for tenant config (catastrophic at scale) |
| SQS/RabbitMQ | `curl -s http://tenant:3002/ready \| jq .checks.queue` | Tenant provisioning stops |
| Identity-service (Keycloak realm) | `curl -s http://identity:3001/health` | New tenant Keycloak realm not created |
| Install-service (DB provisioning) | `curl -s http://install:3005/health` | Silo tenant DB not provisioned |

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Tenant Overview | `https://grafana.internal/d/tenant-overview` | Tenant count by plan/status, config resolution latency |
| Quota Utilization | `https://grafana.internal/d/tenant-quota` | Per-tenant quota usage heatmap |
| Provisioning | `https://grafana.internal/d/tenant-provisioning` | Creation pipeline, failure rate |
| Subscription Health | `https://grafana.internal/d/tenant-subscriptions` | Churn, upgrades, renewals |

---

## Failure Modes

### FM-01: Tenant config cache stale (platform-wide impact)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `tenant_config_cache_miss_rate > 50%` OR manual report (settings not reflecting) |
| **Impact** | All services serving stale tenant config (wrong timezone, wrong modules enabled) |

**Triage:**

```
Tenant config not reflecting
├── Is it a specific tenant or all?
│   ├── Specific → Cache key not invalidated after update
│   │   → redis-cli -p 6381 DEL "tenant:{tenantId}:config"
│   │   → Next request will rebuild from DB
│   └── All → Redis issue or mass cache corruption
│       → redis-cli -p 6381 PING
│       ├── Redis down → All services fetching from DB (latency spike)
│       │   → Fix Redis. Services will recover automatically.
│       └── Redis up → Check if cache rebuild is needed
│           → Possible cause: Redis flush, memory eviction
│           → redis-cli -p 6381 INFO memory | grep evicted_keys
├── Was there a recent bulk tenant update?
│   → Bulk updates invalidate many keys simultaneously
│   → Cache warms back up in < 5min (lazy load on request)
└── Is the tenant-worker processing update events?
    → curl -s http://tenant-worker:3002/ops/heartbeat
```

**Commands:**

```bash
# Check Redis status
redis-cli -p 6381 PING

# Check cache hit ratio
curl -s http://tenant:3002/ops/metrics | grep -E "cache_hit_ratio|cache_miss"

# Force-invalidate specific tenant cache
redis-cli -p 6381 DEL "tenant:{tenantId}:config"

# Force-invalidate ALL tenant configs (nuclear — causes latency spike)
redis-cli -p 6381 EVAL "for _,k in ipairs(redis.call('keys','tenant:*:config')) do redis.call('del',k) end" 0

# Check eviction pressure
redis-cli -p 6381 INFO memory | grep -E "used_memory_human|maxmemory_human|evicted_keys"

# Check tenant-service can read config from DB
curl -s http://tenant:3002/v1/tenants/{tenantId}/config \
  -H "Authorization: Bearer $TOKEN" | jq '.data.timezone'
```

**Verification after fix:**

```bash
# Cache hit ratio recovering
watch -n10 'curl -s http://tenant:3002/ops/metrics | grep cache_hit_ratio'

# Specific tenant config reads correctly
curl -s http://tenant:3002/v1/tenants/{tenantId}/config \
  -H "Authorization: Bearer $TOKEN" | jq '.data'
```

**Communication template:**

> 🟡 **[P1] Tenant config cache stale — platform-wide settings inconsistency**  
> Tenant settings not reflecting for {specific tenant | all tenants}.  
> Root cause: {Redis eviction | cache invalidation bug | Redis down}.  
> Service functionality unaffected. Config accuracy degraded.  
> ETR: {5 min for cache rebuild | 15 min for Redis fix}.

---

### FM-02: Tenant creation not completing (partial state)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `tenant_creation_stuck_count > 0` |
| **Impact** | New tenants can't onboard — sales/activation blocked |

**Triage:**

```
Tenant creation incomplete
├── Which step failed?
│   → psql civitas_tenant -c "SELECT id, status, provisioning_step FROM tenant.tenants
│      WHERE status = 'provisioning' ORDER BY created_at DESC LIMIT 5;"
│   ├── step: "keycloak_realm" → Identity-service didn't process
│   │   → Check identity-worker health and DLQ
│   ├── step: "db_provisioning" → Install-service didn't provision DB
│   │   → Check install-service health (for silo tenants only)
│   └── step: "default_config" → Tenant-worker itself stuck
│       → Check tenant-worker DLQ
├── Is creation idempotent?
│   → Yes. Re-triggering the creation command is safe.
└── Has this been stuck > 1 hour?
    → Manual intervention needed. Check all downstream services.
```

**Commands:**

```bash
# Find stuck tenants
psql civitas_tenant -c "
  SELECT id, status, provisioning_step, created_at, 
         NOW() - created_at as stuck_duration
  FROM tenant.tenants
  WHERE status = 'provisioning'
  ORDER BY created_at DESC LIMIT 10;
"

# Check identity-service processed the realm creation
curl -s http://identity-worker:3001/ops/dlq/peek?topic=identity.realm.create | jq .

# Check install-service for DB provisioning (silo tenants)
curl -s http://install:3005/v1/install/status/{tenantId} \
  -H "Authorization: Bearer $TOKEN" | jq '.data.dbStatus'

# Re-trigger tenant creation (idempotent)
curl -X POST http://tenant-worker:3002/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "tenant.tenant.create", "batchSize": 5}'

# Check tenant-worker DLQ
curl -s http://tenant-worker:3002/ops/dlq | jq .
```

---

### FM-03: Tenant isolation failure (SECURITY — P0)

| Field | Value |
|-------|-------|
| **Severity** | P0 (SECURITY) |
| **Time to act** | IMMEDIATE |
| **Alert** | Manual detection (cross-tenant data visible) |
| **Impact** | Cross-tenant data leak — security breach, legal exposure |

**Commands:**

```bash
# IMMEDIATE: Verify RLS is enabled on all tenant tables
psql civitas_tenant -c "
  SELECT tablename, rowsecurity
  FROM pg_tables
  WHERE schemaname = 'tenant'
  AND rowsecurity = false;
"

# Check if tenant isolation mode is correctly set
psql civitas_tenant -c "
  SELECT id, isolation_mode, status
  FROM tenant.tenants
  WHERE id IN ('{affectedTenantId}', '{leakSourceTenantId}');
"

# Check gateway tenant header propagation
curl -s http://gateway:8080/ops/request-log?last=10 | jq '.[].headers["x-tenant-id"]'

# IMMEDIATE: If confirmed leak, suspend the affected endpoint
# Coordinate with Security team for incident response
```

**Communication template:**

> 🔴 **[P0 — SECURITY] Tenant isolation failure detected**  
> Cross-tenant data visible. Affected: tenant {A} seeing data from tenant {B}.  
> IMMEDIATE investigation. RLS/isolation mode check in progress.  
> Security incident response initiated. Potential DPDP Act reporting obligation.

---

### FM-04: Consumer stalled (tenant-worker)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `tenant_worker_heartbeat_stale > 60s` |
| **Impact** | Tenant creates, config updates, quota changes not processing |

**Commands:**

```bash
# Check worker heartbeat
curl -s http://tenant-worker:3002/ops/heartbeat | jq .

# Restart worker
docker restart civitasone-tenant-worker

# Verify recovery
curl -s http://tenant-worker:3002/ops/heartbeat | jq '.ageSeconds < 10'

# Check DLQ
curl -s http://tenant-worker:3002/ops/dlq | jq .depth
```

---

## Rollback

```bash
# Docker
docker pull civitasone/tenant-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d tenant-service tenant-worker

# K8s
kubectl set image deployment/tenant-service \
  tenant=civitasone/tenant-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/tenant-worker \
  worker=civitasone/tenant-service:$PREVIOUS_TAG -n civitasone

# IMMEDIATELY rebuild tenant config cache
redis-cli -p 6381 EVAL "for _,k in ipairs(redis.call('keys','tenant:*:config')) do redis.call('del',k) end" 0

# Verify health
curl -s http://tenant:3002/health | jq .
```

Tenant records are immutable (never delete — only suspend). Plan definitions are versioned.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** < 15 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh tenant --target-time="2026-07-26T02:00:00Z"

# 2. IMMEDIATELY rebuild tenant config cache
redis-cli -p 6381 EVAL "for _,k in ipairs(redis.call('keys','tenant:*:config')) do redis.call('del',k) end" 0

# 3. Verify no tenants in inconsistent isolation state
psql civitas_tenant -c "
  SELECT id, isolation_mode, status, provisioning_step
  FROM tenant.tenants
  WHERE status = 'provisioning';
"

# 4. Confirm subscription statuses match billing-service
psql civitas_tenant -c "
  SELECT subscription_status, COUNT(*) FROM tenant.tenants GROUP BY subscription_status;
"

# 5. Replay outbox
curl -X POST http://tenant-worker:3002/ops/outbox-relay/replay-pending

# 6. Verify all services can resolve tenant config
curl -s http://gateway:8080/health | jq '.checks'
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Tenant service restored**  
> DB restored to {timestamp}. Config cache rebuilt. Isolation modes verified.  
> All {N} tenants accessible. No provisioning gaps detected.  
> Subscription states reconciled with billing-service.
