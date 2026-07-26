# Runbook: hrms-service

> **Tier 1** | SLO: 99.9% availability, p95 read < 500 ms, DLQ = 0  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** HR Domain Owner | **Escalation:** SRE → CTO  
> **Slack:** `#incident-hrms` | **PagerDuty:** `hrms-critical`  

---

## Purpose

Employee lifecycle (onboard → attendance → leave → confirmation/promotion/transfer/separation), recruitment, appraisal/APAR, medical/LTC/CEA claims, pension, GPF, service-book, geo-attendance, seniority, ID cards, reservation roster, and workforce planning. Platform's largest test suite (271 tests). Field-level PII encryption (AES-256-GCM) on all employee sensitive data — DPDP Act 2023 compliance backbone. Owns `civitas_hrms`.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_hrms`) | `curl -s http://hrms:3012/ready \| jq .checks.db` | Total outage |
| Redis | `curl -s http://hrms:3012/ready \| jq .checks.cache` | Degraded reads (PII decryption + DB direct = high latency) |
| SQS/RabbitMQ | `curl -s http://hrms:3012/ready \| jq .checks.queue` | Command processing stops |
| Payroll-service (circuit-breaker) | `curl -s http://hrms:3012/ops/circuit-breakers \| jq .payroll` | Payroll-derived fields degraded (not 500) |
| Keycloak (auth) | `curl -s http://hrms:3012/ready \| jq .checks.auth` | All authenticated requests fail |
| Estab-service (eOffice callbacks) | `curl -s http://estab:3010/health` | HR file approvals (transfer, promotion) stuck |

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| HRMS Overview | `https://grafana.internal/d/hrms-overview` | p95 latency, error rate, throughput |
| DLQ Monitor | `https://grafana.internal/d/hrms-dlq` | DLQ depth by topic, oldest message |
| PII Health | `https://grafana.internal/d/hrms-pii` | Decryption error rate, keyring status |
| Geo-Attendance | `https://grafana.internal/d/hrms-geoatt` | Check-in success rate, GPS accuracy |

---

## Failure Modes

### FM-01: PII decryption failure (employee reads broken)

| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **Time to act** | IMMEDIATE (< 5 min) |
| **Alert** | `hrms_pii_decryption_error_total` increasing |
| **Impact** | All employee record reads fail — HR completely blocked |

**Triage:**

```
PII decryption errors
├── Was PII_ENC_KEY recently rotated?
│   → Check deployment history for env var changes
│   ├── Yes → Was prior key removed from keyring?
│   │   → Old envelopes (enc:v1 or enc:v2:<old_keyid>) can't decrypt
│   │   → FIX: Re-add prior key to keyring. NEVER remove old keys.
│   └── No → Check PII_ENC_KEY / PII_ENC_SALT presence
│       → docker exec civitasone-hrms env | grep PII_ENC | wc -l
│       ├── 0 → Config deployment error. Restore from secret manager.
│       └── Present → Possible DB corruption or wrong key
│           → Check error envelope format in logs (enc:v1 vs enc:v2)
│           → Test specific employee decryption
├── Is it ALL employees or specific records?
│   ├── All → Systemic key issue
│   └── Specific → Data corruption on those rows (restore from backup)
└── NEVER log the raw ciphertext or decrypted PII while diagnosing
```

**Commands:**

```bash
# Check PII env vars are set (DO NOT log values)
docker exec civitasone-hrms env | grep PII_ENC | wc -l

# Check recent decryption errors
docker logs civitasone-hrms --since=5m 2>&1 | grep -i "decrypt" | grep -i "error" | tail -20

# Test PII health (internal diagnostic endpoint)
curl -s http://hrms:3012/ops/health-deep | jq '.checks.pii_decryption'

# Check which envelope versions exist in DB (without exposing data)
psql civitas_hrms -c "
  SELECT 
    CASE 
      WHEN bank_account_no LIKE 'enc:v1:%' THEN 'v1'
      WHEN bank_account_no LIKE 'enc:v2:%' THEN 'v2'
      ELSE 'plaintext'
    END as envelope_version,
    COUNT(*)
  FROM hrms.employees
  WHERE bank_account_no IS NOT NULL
  GROUP BY 1;
"

# Restart after fixing env
docker restart civitasone-hrms
```

**Verification after fix:**

```bash
# PII decryption health check passes
curl -s http://hrms:3012/ops/health-deep | jq '.checks.pii_decryption == "ok"'

# Employee list endpoint works
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  http://hrms:3012/v1/hrms/employees?limit=5

# No new decryption errors
watch -n5 'curl -s http://hrms:3012/ops/metrics | grep pii_decryption_error'
```

**Communication template:**

> 🔴 **[P0] HRMS PII decryption failure — employee records unreadable**  
> All employee profile reads failing. Root cause: {key rotation dropped prior key | env missing | corruption}.  
> No data breach — encrypted data intact. HR operations blocked.  
> ETR: {5 min for config fix | 30 min for data investigation}.

---

### FM-02: Consumer stalled (hrms-worker)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `hrms_worker_heartbeat_stale > 60s` |
| **Impact** | Employee lifecycle commands (onboard, leave, attendance) stop processing |

**Triage:**

```
Worker heartbeat stale
├── Check worker process alive
│   → docker ps --filter "name=hrms-worker"
│   ├── Dead → Check crash logs (OOM common with large workforce queries)
│   │   → docker logs civitasone-hrms-worker --tail=50
│   │   → FIX: Restart
│   └── Alive → Check DB connectivity
│       → curl -s http://hrms:3012/ready | jq .checks.db
│       ├── Unhealthy → Postgres issue
│       └── Healthy → Check consumer status
│           → curl -s http://hrms-worker:3012/ops/consumer-status | jq .
```

**Commands:**

```bash
# Check worker heartbeat
curl -s http://hrms-worker:3012/ops/heartbeat | jq .

# View recent worker logs
docker logs civitasone-hrms-worker --tail=100 --since=5m 2>&1 | grep -E "ERROR|FATAL"

# Restart worker (Docker)
docker restart civitasone-hrms-worker

# Restart worker (K8s)
kubectl rollout restart deployment/hrms-worker -n civitasone

# Check DLQ depth
curl -s http://hrms-worker:3012/ops/dlq | jq .depth
```

**Verification after fix:**

```bash
curl -s http://hrms-worker:3012/ops/heartbeat | jq '.ageSeconds < 10'
watch -n5 'curl -s http://hrms-worker:3012/ops/dlq | jq .depth'
```

**Communication template:**

> 🟡 **[P1] HRMS worker stalled — employee commands not processing**  
> Leave applications, attendance marks, onboarding queued safely.  
> Root cause: {OOM | DB connection | poison message}. ETR: {5 min}.

---

### FM-03: Payroll-client circuit breaker open

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `hrms_circuit_breaker_state{service="payroll"} == "open"` |
| **Impact** | Payroll-derived fields (salary info, deductions) degraded/omitted on employee reads |

**Triage:**

```
Payroll circuit breaker open
├── Is payroll-service actually down?
│   → curl -s http://payroll:3013/health | jq .
│   ├── Down → See payroll runbook. HRMS is behaving correctly (graceful degradation).
│   └── Up → Transient network issue or payroll was slow (5 timeouts triggered breaker)
│       → Breaker will auto-recover in 30s (half-open → test → closed)
│       → Monitor: curl -s http://hrms:3012/ops/circuit-breakers | jq .payroll
└── HRMS should NEVER return 500 due to payroll being down
    → Employee reads work with payroll fields omitted/degraded
    → If you see 500s, it's an HRMS bug, not a payroll issue
```

**Commands:**

```bash
# Check circuit breaker state
curl -s http://hrms:3012/ops/circuit-breakers | jq '.payroll'

# Check payroll health directly
curl -s http://payroll:3013/health | jq .

# Monitor breaker recovery
watch -n5 'curl -s http://hrms:3012/ops/circuit-breakers | jq .payroll.state'
```

---

### FM-04: eOffice callback not landing (approval stuck)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | Manual report (transfer/promotion approval stuck) |
| **Impact** | Specific HR file decisions not updating employee records |

**Commands:**

```bash
# Check estab-service outbox for pending decision events
curl -s http://estab-worker:3010/ops/outbox-relay | jq '.pendingCount'

# Check if the specific eOffice callback topic is flowing
curl -s http://hrms-worker:3012/ops/consumer-status | jq '.topics[] | select(.name | contains("file_decided"))'

# Look for the specific event in DLQ
curl -s http://hrms-worker:3012/ops/dlq/peek?topic=hrms.transfer.file_decided | jq .

# Check MODULE_CALLBACK_TOPICS mapping
docker logs civitasone-hrms-worker --since=1h 2>&1 | grep "file_decided" | tail -10

# Force outbox relay restart on estab-service (source of callbacks)
curl -X POST http://estab-worker:3010/ops/outbox-relay/restart
```

---

### FM-05: p95 read latency high (> 500ms)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `hrms_http_request_duration_seconds{quantile="0.95"} > 0.5` |
| **Impact** | Slow HR screens; PII decryption adds per-row CPU cost on cache miss |

**Commands:**

```bash
# Check cache hit ratio (PII decrypt on every miss makes this critical)
curl -s http://hrms:3012/ops/metrics | grep -E "cache_hit_ratio|cache_miss"

# Check Redis
redis-cli -p 6381 INFO memory | grep -E "used_memory_human|evicted_keys"

# Check slow queries (large department joins are common)
psql civitas_hrms -c "
  SELECT pid, NOW() - query_start AS duration, left(query, 100)
  FROM pg_stat_activity
  WHERE state = 'active' AND datname = 'civitas_hrms'
  AND query_start < NOW() - INTERVAL '200ms'
  ORDER BY duration DESC LIMIT 10;
"

# Check DB pool
curl -s http://hrms:3012/ops/metrics | grep -E "db_pool_size|db_pool_used"
```

---

## Rollback

```bash
# Docker
docker pull civitasone/hrms-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d hrms-service hrms-worker

# K8s
kubectl set image deployment/hrms-service \
  hrms=civitasone/hrms-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/hrms-worker \
  worker=civitasone/hrms-service:$PREVIOUS_TAG -n civitasone

# Verify health
curl -s http://hrms:3012/health | jq .
```

**CRITICAL:** Never rollback a `PII_ENC_KEY` rotation without confirming the keyring still contains every key ID referenced by existing `enc:v2:<keyid>:` envelopes.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh hrms --target-time="2026-07-26T02:00:00Z"

# 2. Verify PII decryption on restored data (CRITICAL)
curl -s http://hrms:3012/ops/health-deep | jq '.checks.pii_decryption'

# 3. Sample-test employee records (bank account, PAN, Aadhaar decrypt)
psql civitas_hrms -c "SELECT id FROM hrms.employees LIMIT 5;" | while read id; do
  curl -s -H "Authorization: Bearer $TOKEN" http://hrms:3012/v1/hrms/employees/$id | jq '.data.bankAccountNo | length > 0'
done

# 4. Replay outbox
curl -X POST http://hrms-worker:3012/ops/outbox-relay/replay-pending

# 5. Verify audit continuity
curl -s "http://audit:3004/v1/audit/events?service=hrms&since=2026-07-26T01:00:00Z" \
  -H "Authorization: Bearer $TOKEN" | jq '.meta.total'

# 6. Verify attendance/leave state consistency
psql civitas_hrms -c "
  SELECT COUNT(*) FROM hrms.leave_applications
  WHERE status = 'pending' AND created_at > '2026-07-26T01:45:00Z';
"
```

**Post-recovery communication:**

> ✅ **[RESOLVED] HRMS service restored**  
> DB restored to {timestamp}. PII decryption verified on sample records.  
> Outbox replayed. Audit trail continuous. Leave/attendance state consistent.  
> No employee data loss confirmed.
