# Runbook: gateway-service

> **Tier 0** | SLO: 99.95% availability, p95 < 100 ms (proxy overhead), zero auth bypass  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Platform Engineering | **Escalation:** SRE → CTO  
> **Slack:** `#incident-platform` | **PagerDuty:** `platform-critical`  

---

## Purpose

Single external entry point for the entire platform. Handles CORS/Helmet/security-headers, fleet-wide rate-limiting (100 req/min per user, 1000 req/min service-to-service), JWT edge verification (RS256 via Keycloak JWKS), module-guard/ABAC enforcement, and reverse proxy to all 41+ upstreams. Owns no domain database (stateless proxy). If gateway is down, the entire platform is inaccessible.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Redis (rate-limit + session cache) | `curl -s http://gateway:8080/health \| jq .checks.redis` | Rate-limiting disabled (fail-open vs fail-closed per config) |
| Keycloak (JWKS endpoint) | `curl -s http://gateway:8080/health \| jq .checks.keycloak` | Cannot verify JWTs → all requests rejected (fail-closed) |
| Upstream services (41) | `curl -s http://gateway:8080/ready` | Individual service degradation |
| Postgres (API catalogue) | `curl -s http://gateway:8080/health \| jq .checks.db` | Catalogue unavailable (proxy routing unaffected) |

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Gateway Overview | `https://grafana.internal/d/gateway-overview` | RPS, error rate, p95 latency, upstream status |
| Rate Limiting | `https://grafana.internal/d/gateway-ratelimit` | Rate-limit hits per tenant/user, 429 rate |
| JWT/Auth | `https://grafana.internal/d/gateway-auth` | Auth failure rate, JWKS refresh status |
| Upstream Health | `https://grafana.internal/d/gateway-upstreams` | Per-service availability, response times |

---

## Failure Modes

### FM-01: Gateway unreachable (total platform outage)

| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **Time to act** | IMMEDIATE (< 2 min) |
| **Alert** | `probe_success{job="gateway"} == 0` |
| **Impact** | Total platform outage — no user can access anything |

**Triage:**

```
Gateway unreachable
├── Is it the gateway process or network?
│   → From within the network: curl -s http://gateway:8080/health
│   ├── Connection refused → Process is dead
│   │   → Check: docker ps | grep gateway  OR  kubectl get pods -l app=gateway
│   │   ├── Container/pod not running → Check crash logs
│   │   │   → docker logs civitasone-gateway --tail=50
│   │   │   → kubectl logs -l app=gateway --tail=50
│   │   │   → Common: OOM kill, port conflict, env var missing
│   │   │   → FIX: Restart. If OOM, increase memory limit.
│   │   └── Container running but not responding → Check event loop block
│   │       → Possible cause: JWKS fetch hanging (Keycloak unreachable)
│   │       → FIX: Restart gateway + verify Keycloak health
│   └── Responds internally but not externally → Load balancer / DNS issue
│       → Check ALB/Nginx health targets
│       → Check DNS resolution: dig gateway.civitasone.internal
```

**Commands:**

```bash
# Check gateway health (from inside network)
curl -s http://gateway:8080/health | jq .

# Check if process is running
docker ps --filter "name=gateway" --format "{{.Status}}"
# or K8s:
kubectl get pods -l app=gateway-service -n civitasone

# View recent logs for crash reason
docker logs civitasone-gateway --tail=100 --since=5m 2>&1 | grep -E "ERROR|FATAL|OOM"
# or K8s:
kubectl logs -l app=gateway-service --tail=100 -n civitasone | grep -E "ERROR|FATAL"

# Emergency restart
docker restart civitasone-gateway
# or K8s:
kubectl rollout restart deployment/gateway-service -n civitasone

# Check if port is in use by another process
ss -tlnp | grep 8080
```

**Verification after fix:**

```bash
# Health check passes
curl -s http://gateway:8080/health | jq '.status == "ok"'

# External probe succeeds
curl -s -o /dev/null -w "%{http_code}" https://api.civitasone.example.com/health

# Verify traffic flowing (should see increasing request count)
watch -n2 'curl -s http://gateway:8080/metrics | grep gateway_http_requests_total'
```

**Communication template:**

> 🔴 **[P0] TOTAL PLATFORM OUTAGE — Gateway unreachable**  
> All services inaccessible. Root cause: {process crash | OOM | Keycloak down | network}.  
> ETR: {2 min for restart | 15 min for dependency fix}.  
> Status page updated.

---

### FM-02: JWT verification failing (all requests getting 401)

| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **Time to act** | < 5 min |
| **Alert** | `gateway_auth_failure_rate > 50%` for 2 min |
| **Impact** | All authenticated users locked out |

**Triage:**

```
Mass 401 responses
├── Is Keycloak reachable from gateway?
│   → curl -s http://keycloak:8080/realms/civitasone/.well-known/openid-configuration | jq .issuer
│   ├── Unreachable → Keycloak is down
│   │   → docker ps | grep keycloak
│   │   → docker restart civitasone-keycloak
│   └── Reachable → JWKS cache stale or key rotation issue
│       → Check JWKS fetch: curl -s http://keycloak:8080/realms/civitasone/protocol/openid-connect/certs | jq '.keys | length'
│       ├── 0 keys → Keycloak realm misconfigured
│       └── Keys present → Gateway JWKS cache mismatch
│           → Check if a key rotation just happened (new kid in token doesn't match cached keys)
│           → FIX: Force JWKS refresh (restart gateway to clear cache)
├── Did NODE_ENV or JWT_ALGORITHM change?
│   → Verify: env vars on gateway container match expected (RS256 in prod, HS256 in test only)
└── Is it ALL users or specific ones?
    ├── All → Systemic (JWKS/Keycloak issue)
    └── Specific → Token expired, user session revoked, or role binding removed
```

**Commands:**

```bash
# Test JWKS endpoint directly
curl -s http://keycloak:8080/realms/civitasone/protocol/openid-connect/certs | jq '.keys | length'

# Check gateway's cached JWKS age
curl -s http://gateway:8080/ops/jwks-status | jq '.'

# Force JWKS cache refresh (if endpoint exists)
curl -X POST http://gateway:8080/ops/jwks-refresh

# If all else fails, restart to clear in-memory JWKS cache
docker restart civitasone-gateway

# Check a specific user's token validity (decode without verify for debugging)
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq '.exp, .iss, .kid'
```

**Communication template:**

> 🔴 **[P0] Authentication system failure — users locked out**  
> All requests receiving 401. Root cause: {Keycloak unreachable | JWKS key rotation | config error}.  
> No data loss or security breach — fail-closed behavior (correct).  
> ETR: {5 min for restart | 15 min for Keycloak recovery}.

---

### FM-03: Rate limiting triggering incorrectly (legitimate users getting 429)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `gateway_rate_limit_hit_total` spike > 5x normal |
| **Impact** | Legitimate users throttled; service degraded |

**Triage:**

```
Unexpected 429s
├── Is it a specific tenant/user or platform-wide?
│   → Check Grafana rate-limit dashboard (per-tenant breakdown)
│   ├── Single tenant → Likely legitimate spike (bulk import, script, bot)
│   │   → Verify with tenant admin. Increase limit if justified.
│   └── Platform-wide → Rate-limit config error or Redis issue
│       → Check Redis: redis-cli -p 6381 PING
│       ├── Redis down → Rate-limit keys lost. Gateway may be re-computing from zero.
│       │   → Fix Redis first. Rate limits will stabilize once counters rebuild.
│       └── Redis healthy → Check rate-limit config (env vars)
│           → RATE_LIMIT_USER_PER_MIN (default: 100)
│           → RATE_LIMIT_SERVICE_PER_MIN (default: 1000)
│           → Did someone accidentally lower these?
```

**Commands:**

```bash
# Check current rate-limit config
docker exec civitasone-gateway env | grep RATE_LIMIT

# Check specific user's rate-limit counter in Redis
redis-cli -p 6381 GET "ratelimit:user:{userId}:{currentMinute}"

# Check tenant-level rate-limit
redis-cli -p 6381 GET "ratelimit:tenant:{tenantId}:{currentMinute}"

# Temporarily increase limit for a specific tenant (emergency)
redis-cli -p 6381 SET "ratelimit:override:tenant:{tenantId}" 500 EX 3600

# Check who's hitting limits most
curl -s http://gateway:8080/ops/rate-limit-top | jq '.top10'
```

---

### FM-04: Specific upstream service returning 5xx

| Field | Value |
|-------|-------|
| **Severity** | P2 (isolated to one module) |
| **Time to act** | < 15 min |
| **Alert** | `gateway_upstream_error_rate{service="X"} > 5%` |
| **Impact** | Single module degraded; rest of platform healthy |

**Commands:**

```bash
# Check which upstream is failing
curl -s http://gateway:8080/ops/upstream-health | jq '.[] | select(.errorRate > 0.05)'

# Check specific upstream health directly (bypass gateway)
curl -s http://{service}:{port}/health | jq .
curl -s http://{service}:{port}/ready | jq .

# Check gateway's view of the upstream
curl -s http://gateway:8080/ops/route-status/{service-name} | jq .

# View recent errors for that upstream in gateway logs
docker logs civitasone-gateway --since=5m 2>&1 | grep -i "{service}" | grep -i "error" | tail -20
```

---

### FM-05: Memory/CPU spike on gateway

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `container_memory_usage{name="gateway"} > 90%` |
| **Impact** | Gateway may OOM-kill → total outage |

**Commands:**

```bash
# Check current resource usage
docker stats civitasone-gateway --no-stream
# or K8s:
kubectl top pod -l app=gateway-service -n civitasone

# Check for abnormal request patterns (DDoS, runaway client)
curl -s http://gateway:8080/ops/rate-limit-top | jq '.top10'

# Check active connections
curl -s http://gateway:8080/ops/metrics | grep -E "active_connections|open_connections"

# If OOM imminent, scale horizontally (K8s)
kubectl scale deployment/gateway-service --replicas=3 -n civitasone

# Emergency: restart before OOM kills it (preserves graceful shutdown)
docker restart civitasone-gateway
```

---

## Rollback

```bash
# Docker
docker pull civitasone/gateway-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d gateway-service

# K8s
kubectl set image deployment/gateway-service \
  gateway=civitasone/gateway-service:$PREVIOUS_TAG -n civitasone

# Verify health post-rollback
curl -s http://gateway:8080/health | jq .
```

Gateway is stateless — rollback is fast and safe. The only concern is if the API catalogue migration was applied (new DB — check if rollback drops needed routes).

---

## Recovery (RPO/RTO)

**RPO:** N/A (stateless) | **RTO:** < 2 min (restart or failover)

Gateway is stateless. Recovery = restart. No data to restore.

```bash
# 1. Restart gateway
docker restart civitasone-gateway

# 2. Verify health
curl -s http://gateway:8080/health | jq '.status'

# 3. Verify external access
curl -s -o /dev/null -w "%{http_code}" https://api.civitasone.example.com/health

# 4. Verify all upstreams reachable
curl -s http://gateway:8080/ops/upstream-health | jq '.[].healthy' | sort | uniq -c

# 5. Verify rate-limit state (Redis)
redis-cli -p 6381 PING
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Gateway recovered**  
> Service restored at {timestamp}. All {N} upstreams healthy.  
> Root cause: {OOM | Keycloak dependency | config error | restart resolved}.  
> No data loss (gateway is stateless).
