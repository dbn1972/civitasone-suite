# Runbook: identity-service

> **Tier 0** | SLO: 99.95% availability, p95 token-validate < 150 ms, zero auth bypass  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Security Engineering | **Escalation:** Security → SRE → CTO  
> **Slack:** `#incident-identity` | **PagerDuty:** `identity-critical`  

---

## Purpose

Authentication and identity domain of record — user/session lifecycle, MFA enrollment, RBAC (roles/permissions/grants), password reset, device management. Backs Keycloak-issued RS256 JWTs and is the gateway's public-prefix exception (`/api/identity` is unauthenticated for login/refresh). If identity is down, no user can log in — full platform outage equivalent. Owns `civitas_identity`.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_identity`) | `curl -s http://identity:3001/ready \| jq .checks.db` | Total outage — no user/session reads |
| Redis (session/JWKS cache) | `curl -s http://identity:3001/ready \| jq .checks.cache` | Cache miss → live Keycloak round-trips (latency spike) |
| SQS/RabbitMQ | `curl -s http://identity:3001/ready \| jq .checks.queue` | Command processing stops (user creates, session revokes) |
| Keycloak 24 (OIDC/SAML) | `curl -s http://keycloak:8080/realms/civitasone/.well-known/openid-configuration \| jq .issuer` | JWT verification fails → mass 401s |
| Gateway (routing) | `curl -s http://gateway:8080/health \| jq .checks.identity` | Login endpoints unreachable externally |

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Identity Overview | `https://grafana.internal/d/identity-overview` | p95 latency, error rate, session-create rate |
| Auth/Token | `https://grafana.internal/d/identity-auth` | Token validate latency, JWKS refresh, MFA rate |
| DLQ Monitor | `https://grafana.internal/d/identity-dlq` | DLQ depth by topic, oldest message age |
| RBAC Activity | `https://grafana.internal/d/identity-rbac` | Grant/revoke volume, binding churn |

---

## Failure Modes

### FM-01: Consumer stalled (identity-worker heartbeat stale)

| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **Time to act** | IMMEDIATE (< 5 min) |
| **Alert** | `identity_worker_heartbeat_stale > 60s` |
| **Impact** | User creates, session revokes, RBAC grants all stop processing |

**Triage:**

```
Worker heartbeat stale
├── Check worker process alive
│   → docker ps --filter "name=identity-worker" OR kubectl get pods -l app=identity-worker
│   ├── Process dead → Check crash logs
│   │   → docker logs civitasone-identity-worker --tail=50
│   │   → Common: OOM, DB connection exhausted, env var missing
│   │   → FIX: Restart worker
│   └── Process alive → Check DB connectivity
│       → curl -s http://identity:3001/ready | jq .checks.db
│       ├── db: unhealthy → Check Postgres (connection pool exhausted?)
│       │   → psql civitas_identity -c "SELECT count(*) FROM pg_stat_activity;"
│       └── db: healthy → Check last processed message
│           → curl -s http://identity-worker:3001/ops/consumer-status | jq .
│           ├── Stuck on specific message → Poison message candidate
│           │   → Peek DLQ for validation errors
│           └── No messages arriving → Check SQS/RabbitMQ health
```

**Commands:**

```bash
# Check worker heartbeat
curl -s http://identity-worker:3001/ops/heartbeat | jq .

# Check last processed message
curl -s http://identity-worker:3001/ops/consumer-status | jq '.lastProcessedAt'

# View recent worker logs
docker logs civitasone-identity-worker --tail=100 --since=5m 2>&1 | grep -E "ERROR|FATAL|stuck"

# Restart worker (Docker)
docker restart civitasone-identity-worker

# Restart worker (K8s)
kubectl rollout restart deployment/identity-worker -n civitasone

# Check DB connection pool
curl -s http://identity:3001/ops/metrics | grep -E "db_pool_size|db_pool_used"
```

**Verification after fix:**

```bash
# Confirm heartbeat is fresh (< 10s ago)
curl -s http://identity-worker:3001/ops/heartbeat | jq '.ageSeconds < 10'

# Confirm DLQ is not growing
watch -n5 'curl -s http://identity-worker:3001/ops/dlq | jq .depth'

# Confirm session/user events flowing
curl -s http://identity:3001/ops/metrics | grep identity_commands_processed_total
```

**Communication template:**

> 🔴 **[P0] Identity worker stalled — user/session commands not processing**  
> All user creates, session revokes, RBAC grants halted. Root cause: {OOM | DB unreachable | poison message}.  
> Login path unaffected (reads still work). Write operations queued safely.  
> ETR: {2 min for restart | 15 min for DB fix}.

---

### FM-02: Platform-wide 401 spike (Keycloak/JWKS failure)

| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **Time to act** | IMMEDIATE (< 2 min) |
| **Alert** | `identity_auth_failure_rate > 50%` for 2 min |
| **Impact** | All authenticated users locked out platform-wide |

**Triage:**

```
Mass 401 responses
├── Is Keycloak reachable from identity-service?
│   → curl -s http://keycloak:8080/realms/civitasone/.well-known/openid-configuration | jq .issuer
│   ├── Unreachable → Keycloak is down
│   │   → docker ps | grep keycloak
│   │   → docker restart civitasone-keycloak
│   │   → Wait 30s for JWKS cache rebuild
│   └── Reachable → Check JWKS endpoint
│       → curl -s http://keycloak:8080/realms/civitasone/protocol/openid-connect/certs | jq '.keys | length'
│       ├── 0 keys → Keycloak realm misconfigured
│       └── Keys present → Cache mismatch or key rotation
│           → Force JWKS refresh or restart identity to clear cache
├── Is INTERNAL_SERVICE_SECRET in sync with gateway?
│   → docker exec civitasone-identity env | grep INTERNAL_SERVICE_SECRET | md5sum
│   → docker exec civitasone-gateway env | grep INTERNAL_SERVICE_SECRET | md5sum
│   → Must match. If mismatched → redeploy with correct secret.
└── Is it ALL users or specific?
    ├── All → Systemic (Keycloak/JWKS/secret issue)
    └── Specific → Token expired, session revoked, role removed
```

**Commands:**

```bash
# Test Keycloak OIDC discovery
curl -s http://keycloak:8080/realms/civitasone/.well-known/openid-configuration | jq .issuer

# Test JWKS endpoint
curl -s http://keycloak:8080/realms/civitasone/protocol/openid-connect/certs | jq '.keys | length'

# Check identity service health
curl -s http://identity:3001/health | jq .

# Check if INTERNAL_SERVICE_SECRET matches between services
docker exec civitasone-identity env | grep INTERNAL_SERVICE_SECRET | wc -c
docker exec civitasone-gateway env | grep INTERNAL_SERVICE_SECRET | wc -c

# Force restart to clear JWKS cache
docker restart civitasone-identity

# Decode a failing token for debugging (header + payload only)
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq '.exp, .iss, .sub'
```

**Verification after fix:**

```bash
# Health check passes
curl -s http://identity:3001/health | jq '.status == "ok"'

# Login succeeds
curl -s -X POST http://identity:3001/api/identity/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test"}' | jq '.data.token'

# Gateway auth working
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" \
  http://gateway:8080/api/v1/admin/users
```

**Communication template:**

> 🔴 **[P0] Platform-wide authentication failure — all users locked out**  
> Root cause: {Keycloak down | JWKS key rotation | secret mismatch}.  
> No security breach — fail-closed behavior (correct).  
> ETR: {2 min for restart | 10 min for Keycloak recovery}.

---

### FM-03: PII decryption failure (session/user reads failing)

| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **Time to act** | < 5 min |
| **Alert** | `identity_pii_decryption_error_total` increasing |
| **Impact** | User profile reads fail — degraded login experience |

**Triage:**

```
PII decryption errors
├── Was PII_ENC_KEY recently rotated?
│   → Check if prior key was dropped from keyring
│   ├── Yes → Key rotation broke old envelopes (enc:v1 or enc:v2:<old_keyid>)
│   │   → FIX: Re-add prior key to keyring. Never remove old keys.
│   └── No → Check PII_ENC_KEY / PII_ENC_SALT env vars
│       → docker exec civitasone-identity env | grep PII_ENC
│       ├── Missing → Config deployment error. Restore from secret manager.
│       └── Present → Possible data corruption on specific rows
│           → Check error logs for affected user IDs (NOT the PII itself)
│           → psql civitas_identity -c "SELECT id FROM identity.users WHERE ... LIMIT 5;"
```

**Commands:**

```bash
# Check PII env vars are set (DO NOT log the values)
docker exec civitasone-identity env | grep PII_ENC | wc -l

# Check recent decryption errors in logs
docker logs civitasone-identity --since=5m 2>&1 | grep -i "decrypt" | grep -i "error" | tail -20

# Test that decryption works on a known user (check response, not the PII)
curl -s http://identity:3001/ops/health-deep | jq '.checks.pii_decryption'

# If key rotation issue, restart after fixing env
docker restart civitasone-identity
```

**Communication template:**

> 🔴 **[P0] Identity PII decryption failure**  
> User profile reads failing. Root cause: {key rotation dropped prior key | env var missing | data corruption}.  
> Login still works (JWT validation unaffected). Profile display degraded.  
> ETR: {5 min for config fix | 30 min for data investigation}.

---

### FM-04: DLQ filling on session/user commands

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `identity_dlq_depth{topic=~"identity.*"} > 0` |
| **Impact** | User creates/updates, session revocations delayed |

**Triage:**

```
DLQ messages → read error field
├── "VALIDATION_ERROR" / "ZOD_ERROR"
│   → Poison message from upstream. Fix publisher schema.
│   → Identify source service from message metadata.
├── "DUPLICATE_KEY" / "UNIQUE_CONSTRAINT"
│   → User/session already exists. Safe to acknowledge.
├── "DB_CONNECTION_ERROR" / "TIMEOUT"
│   → Transient. Check DB health, then redrive.
├── "KEYCLOAK_UNREACHABLE"
│   → Session create can't sync to IdP. Wait for Keycloak recovery.
└── Unknown error
    → Escalate to Security on-call within 5 min.
    → Session revoke DLQ entries are SECURITY-CRITICAL (access not being removed).
```

**Commands:**

```bash
# Peek DLQ messages
curl -s http://identity-worker:3001/ops/dlq/peek?limit=5 | jq .

# Check DLQ depth by topic
curl -s http://identity-worker:3001/ops/dlq | jq '.byTopic'

# Redrive after confirming safe (transient errors only)
curl -X POST http://identity-worker:3001/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "identity.user.create", "batchSize": 10}'

# Acknowledge poison messages (after root cause fix deployed)
curl -X POST http://identity-worker:3001/ops/dlq/ack \
  -H "Content-Type: application/json" \
  -d '{"messageIds": ["msg-id-1"]}'

# Check for stuck session revocations (SECURITY CRITICAL)
curl -s http://identity-worker:3001/ops/dlq/peek?topic=identity.session.revoke | jq '.[] | .payload.userId'
```

**Verification after fix:**

```bash
# DLQ depth back to zero
curl -s http://identity-worker:3001/ops/dlq | jq '.depth == 0'

# Commands processing again
curl -s http://identity:3001/ops/metrics | grep identity_commands_processed_total
```

**Communication template:**

> 🟡 **[P1] Identity DLQ accumulating — command processing delayed**  
> DLQ depth: {N} messages. Topics affected: {session.revoke | user.create | rbac.grant}.  
> Root cause: {validation error from upstream | DB transient | Keycloak unreachable}.  
> ETR: {10 min for redrive | 30 min for upstream fix}.

---

### FM-05: p95 token-validate latency high (> 150ms)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `identity_http_request_duration_seconds{quantile="0.95",route="/validate"} > 0.15` |
| **Impact** | Every request platform-wide slows (gateway calls identity on every request) |

**Triage:**

```
High token-validate latency
├── Check Redis session/JWKS cache hit ratio
│   → curl -s http://identity:3001/ops/metrics | grep cache_hit_ratio
│   ├── Hit ratio < 80% → Cache miss storm
│   │   → Check Redis: redis-cli -p 6381 PING
│   │   ├── Redis down → All lookups hitting DB/Keycloak. Fix Redis.
│   │   └── Redis up → Check eviction rate / memory pressure
│   │       → redis-cli -p 6381 INFO memory | grep used_memory_human
│   └── Hit ratio > 95% → DB or Keycloak latency
│       → Check Keycloak JWKS fetch time
│       → Check active DB queries on session table
│       → psql civitas_identity -c "SELECT * FROM pg_stat_activity
│          WHERE state='active' AND query_start < NOW() - INTERVAL '100ms';"
├── Was there a bulk session revoke (revoke_all)?
│   → Revoke-all invalidates many cache keys simultaneously
│   → Cache will warm back up in < 60s. Monitor.
└── Connection pool exhausted?
    → curl -s http://identity:3001/ops/metrics | grep db_pool
```

**Commands:**

```bash
# Check cache hit ratio
curl -s http://identity:3001/ops/metrics | grep -E "cache_hit_ratio|cache_miss"

# Check Redis connectivity
redis-cli -p 6381 PING

# Check Redis memory
redis-cli -p 6381 INFO memory | grep -E "used_memory_human|maxmemory_human|evicted_keys"

# Check slow DB queries
psql civitas_identity -c "
  SELECT pid, NOW() - query_start AS duration, query
  FROM pg_stat_activity
  WHERE state = 'active' AND query_start < NOW() - INTERVAL '100ms'
  ORDER BY duration DESC LIMIT 10;
"

# Check DB pool utilization
curl -s http://identity:3001/ops/metrics | grep -E "db_pool_size|db_pool_used"
```

**Communication template:**

> 🟡 **[P1] Identity token-validate latency elevated — platform-wide slowdown**  
> p95: {X}ms (target: 150ms). Root cause: {Redis miss storm | DB slow queries | Keycloak latency}.  
> All services impacted (gateway validates every request through identity).  
> ETR: {5 min for Redis fix | 15 min for DB optimization}.

---

### FM-06: RBAC grant not taking effect

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | Manual report (user can't access granted resource) |
| **Impact** | Specific users unable to access features they should have |

**Commands:**

```bash
# Check if the RBAC event was published (outbox relay)
curl -s http://identity-worker:3001/ops/outbox-relay | jq '.pendingCount'

# Check outbox for pending RBAC events
psql civitas_identity -c "
  SELECT id, topic, created_at, relayed_at
  FROM identity.outbox
  WHERE topic LIKE 'identity.rbac%' AND relayed_at IS NULL
  ORDER BY created_at DESC LIMIT 10;
"

# Check if consuming service received the event
# (e.g., policy-service should pick up binding changes)
curl -s http://policy:3003/ops/consumer-status | jq '.lastProcessedAt'

# Force outbox relay restart
curl -X POST http://identity-worker:3001/ops/outbox-relay/restart

# Verify the binding exists in identity DB
psql civitas_identity -c "
  SELECT user_id, role_id, granted_at FROM identity.role_bindings
  WHERE user_id = '{userId}' AND tenant_id = '{tenantId}';
"
```

---

## Rollback

```bash
# Docker
docker pull civitasone/identity-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d identity-service identity-worker

# K8s
kubectl set image deployment/identity-service \
  identity=civitasone/identity-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/identity-worker \
  worker=civitasone/identity-service:$PREVIOUS_TAG -n civitasone

# Verify health post-rollback
curl -s http://identity:3001/health | jq .
curl -s http://identity:3001/ready | jq .
```

**Caution:** Migrations are forward-only. Never auto-rollback schema. If a bad migration corrupts session/RBAC data, restore from backup. Never rollback a `PII_ENC_KEY` rotation without confirming the keyring still contains every key ID referenced by existing envelopes.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** < 30 min (but full-outage priority)

A prolonged identity outage = full platform outage (no logins). Takes escalation priority over all other recovery.

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh identity --target-time="2026-07-26T02:00:00Z"

# 2. Verify restore integrity
psql civitas_identity -c "SELECT COUNT(*) FROM identity.users;"
psql civitas_identity -c "SELECT COUNT(*) FROM identity.sessions WHERE expires_at > NOW();"

# 3. Replay outbox (idempotent — safe to replay)
curl -X POST http://identity-worker:3001/ops/outbox-relay/replay-pending

# 4. Verify PII decryption works on restored data
curl -s http://identity:3001/ops/health-deep | jq '.checks.pii_decryption'

# 5. Verify RBAC bindings intact
psql civitas_identity -c "
  SELECT role_id, COUNT(*) FROM identity.role_bindings
  GROUP BY role_id ORDER BY COUNT(*) DESC LIMIT 10;
"

# 6. Verify audit continuity
curl -s "http://audit:3004/v1/audit/events?service=identity&since=2026-07-26T01:00:00Z" \
  -H "Authorization: Bearer $TOKEN" | jq '.meta.total'

# 7. Test login flow end-to-end
curl -s -X POST http://identity:3001/api/identity/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test"}' | jq '.data.token | length > 0'
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Identity service restored**  
> DB restored to {timestamp}. PII decryption verified. RBAC bindings intact.  
> Outbox replayed. Audit trail continuous. Login flow confirmed working.  
> No data loss. All {N} active sessions preserved.
