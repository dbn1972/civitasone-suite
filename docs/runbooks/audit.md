# Runbook: audit-service

> **Tier 1** | SLO: 99.9% availability, event ingest lag < 30s, zero hash-chain breaks  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Audit Domain Owner | **Escalation:** Security → SRE → CTO  
> **Slack:** `#incident-audit` | **PagerDuty:** `audit-critical`  

---

## Purpose

Platform-wide audit event ingestion, tamper-evident hash-chain recording (CERT-In Directions 2022), audit plan/observation/para lifecycle, risk register, pending-recovery tracking, vigilance, and compliance exports. Every mutation across all 33 services emits an audit event to this service via outbox relay. Owns `civitas_audit`. Log retention ≥ 180 days per CERT-In mandate.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_audit`) | `curl -s http://audit:3004/ready \| jq .checks.db` | Total outage — event recording stops |
| Redis | `curl -s http://audit:3004/ready \| jq .checks.cache` | Degraded dashboard/compliance reads |
| SQS/RabbitMQ | `curl -s http://audit:3004/ready \| jq .checks.queue` | Event ingest stops |
| All 33 services (outbox relay) | `curl -s http://audit:3004/ops/metrics \| grep ingest_lag` | Events queue in source outbox tables |
| @civitasone/render (exports) | `curl -s http://audit:3004/ops/circuit-breakers` | Compliance export generation fails |
| @civitasone/storage (S3/MinIO) | Same circuit-breaker endpoint | Export file storage fails |

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Audit Overview | `https://grafana.internal/d/audit-overview` | Event ingest rate, lag, error rate |
| DLQ Monitor | `https://grafana.internal/d/audit-dlq` | DLQ depth (especially `audit.event.ingest`) |
| Hash Chain Health | `https://grafana.internal/d/audit-hashchain` | Chain verification status per tenant |
| Para/Observation | `https://grafana.internal/d/audit-para` | Para lifecycle, SLA compliance |

---

## Failure Modes

### FM-01: Consumer stalled (audit-worker heartbeat stale)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 5 min |
| **Alert** | `audit_worker_heartbeat_stale > 60s` |
| **Impact** | Platform-wide audit trail silently falls behind (all 33 services' outbox tables accumulate) |

**Triage:**

```
Worker heartbeat stale
├── Check worker process alive
│   → docker ps --filter "name=audit-worker" OR kubectl get pods -l app=audit-worker
│   ├── Process dead → Check crash logs
│   │   → docker logs civitasone-audit-worker --tail=50
│   │   → Common: OOM (high ingest volume), DB pool exhausted
│   │   → FIX: Restart worker
│   └── Process alive → Check DB connectivity
│       → curl -s http://audit:3004/ready | jq .checks.db
│       ├── db: unhealthy → Check Postgres connections
│       │   → psql civitas_audit -c "SELECT count(*) FROM pg_stat_activity;"
│       └── db: healthy → Check last processed message
│           → curl -s http://audit-worker:3004/ops/consumer-status | jq .
│           ├── Stuck on specific message → Poison message from one of 33 services
│           │   → Identify source service from message payload
│           └── No messages arriving → All source outbox relays may be stalled
│               → This is NOT an audit-service bug — check source services
```

**Commands:**

```bash
# Check worker heartbeat
curl -s http://audit-worker:3004/ops/heartbeat | jq .

# Check last processed message
curl -s http://audit-worker:3004/ops/consumer-status | jq '.lastProcessedAt'

# View recent logs
docker logs civitasone-audit-worker --tail=100 --since=5m 2>&1 | grep -E "ERROR|FATAL"

# Restart worker (Docker)
docker restart civitasone-audit-worker

# Restart worker (K8s)
kubectl rollout restart deployment/audit-worker -n civitasone

# Check ingest lag (seconds since last event)
curl -s http://audit:3004/ops/metrics | grep audit_ingest_lag_seconds
```

**Verification after fix:**

```bash
# Confirm heartbeat is fresh
curl -s http://audit-worker:3004/ops/heartbeat | jq '.ageSeconds < 10'

# Confirm ingest lag recovering
watch -n5 'curl -s http://audit:3004/ops/metrics | grep audit_ingest_lag_seconds'

# Confirm DLQ not growing
curl -s http://audit-worker:3004/ops/dlq | jq .depth
```

**Communication template:**

> 🟡 **[P1] Audit event ingest stalled — audit trail falling behind**  
> All 33 services still operating normally but audit events accumulating in outbox tables.  
> Root cause: {OOM | DB pool exhausted | poison message from {service}}.  
> No data loss — events are durably queued. ETR: {5 min for restart | 15 min for investigation}.

---

### FM-02: DLQ filling on `audit.event.ingest`

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `audit_dlq_depth{topic="audit.event.ingest"} > 0` |
| **Impact** | Some audit events not being recorded — compliance gap forming |

**Triage:**

```
DLQ message → read error field
├── "VALIDATION_ERROR" / "ZOD_ERROR" / "SCHEMA_MISMATCH"
│   → A publishing service emitted a malformed event
│   → Identify the source service from payload metadata
│   → This is a contract drift in ONE publisher, not an audit-service bug
│   → Fix the publishing service's event schema
├── "HASH_CHAIN_ERROR" / "PREV_HASH_MISMATCH"
│   → CRITICAL: potential chain integrity issue
│   → DO NOT redrive. Escalate to Security immediately.
│   → See FM-03 (Hash chain verification failure)
├── "DB_CONNECTION_ERROR" / "TIMEOUT"
│   → Transient DB issue. Check Postgres health, then redrive.
├── "DUPLICATE_EVENT_ID"
│   → Idempotency check caught a replay. Safe to acknowledge.
└── Unknown error
    → Escalate to Audit domain owner within 5 min.
    → Every unrecorded event is a compliance gap.
```

**Commands:**

```bash
# Peek DLQ messages
curl -s http://audit-worker:3004/ops/dlq/peek?limit=5 | jq .

# Identify which source services are producing bad events
curl -s http://audit-worker:3004/ops/dlq/peek?limit=20 | jq '.[].payload.service' | sort | uniq -c | sort -rn

# Check DLQ depth
curl -s http://audit-worker:3004/ops/dlq | jq '.depth'

# Redrive after confirming safe (transient errors only)
curl -X POST http://audit-worker:3004/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "audit.event.ingest", "batchSize": 50}'

# Acknowledge duplicates
curl -X POST http://audit-worker:3004/ops/dlq/ack \
  -H "Content-Type: application/json" \
  -d '{"messageIds": ["msg-id-1", "msg-id-2"]}'
```

**Verification after fix:**

```bash
# DLQ depth back to zero
curl -s http://audit-worker:3004/ops/dlq | jq '.depth == 0'

# Ingest lag back to normal
curl -s http://audit:3004/ops/metrics | grep audit_ingest_lag_seconds
```

**Communication template:**

> 🟡 **[P1] Audit DLQ accumulating — some events unrecorded**  
> DLQ depth: {N}. Source: {service-name} emitting malformed events.  
> Compliance gap: {N} events unrecorded for up to {duration}.  
> ETR: {10 min for redrive | 1h for upstream schema fix}.

---

### FM-03: Hash chain verification failure

| Field | Value |
|-------|-------|
| **Severity** | P0 (SECURITY/COMPLIANCE) |
| **Time to act** | IMMEDIATE |
| **Alert** | `audit_hash_chain_verification_failure` |
| **Impact** | CERT-In tamper-evidence broken — potential 6-hour incident reporting mandate |

**Triage:**

```
Hash chain break detected
├── Was this during a restore/recovery?
│   ├── Yes → Expected during partial restore. Re-verify after full restore.
│   └── No → POTENTIAL TAMPERING OR CORRUPTION
│       → DO NOT attempt automated repair
│       → DO NOT modify any audit rows
│       → Preserve all evidence (DB snapshots, logs, access records)
│       → Escalate to Security + Legal immediately
├── Identify the break point
│   → Which tenant? Which event ID? What's the gap?
│   → psql civitas_audit query (below)
└── If concurrent-write race condition suspected
    → Check if two workers processed events for same tenant simultaneously
    → This would be a bug, not tampering — but still P0
```

**Commands:**

```bash
# Check which tenant's chain is broken
curl -s http://audit:3004/ops/hash-chain-status | jq '.[] | select(.valid == false)'

# Find the break point in a specific tenant's chain
psql civitas_audit -c "
  SELECT id, tenant_id, occurred_at, prev_hash, 
         encode(digest(concat(id::text, tenant_id::text, event_type, prev_hash, occurred_at::text), 'sha256'), 'hex') as computed_hash
  FROM audit.events
  WHERE tenant_id = '{tenantId}'
  ORDER BY occurred_at DESC LIMIT 20;
"

# Check access logs for unauthorized DB access
psql civitas_audit -c "
  SELECT usename, client_addr, query_start, query
  FROM pg_stat_activity
  WHERE datname = 'civitas_audit'
  ORDER BY query_start DESC LIMIT 20;
"

# Snapshot current state for evidence (DO NOT MODIFY)
pg_dump civitas_audit -t audit.events --data-only > /tmp/audit-evidence-$(date +%s).sql
```

**Do NOT:**
- Do NOT attempt to repair the chain manually
- Do NOT delete or modify any audit event rows
- Do NOT redrive DLQ messages that failed with hash errors
- Do NOT restart the service until Security reviews

**Communication template:**

> 🔴 **[P0 — SECURITY] Audit hash chain integrity failure**  
> Tamper-evident chain broken for tenant {tenantId} at event {eventId}.  
> CERT-In 6-hour reporting clock MAY be triggered.  
> All evidence preserved. Security team notified. Investigation in progress.  
> No automated remediation attempted.

---

### FM-04: Ingest lag high (events accumulating in source outbox tables)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 15 min |
| **Alert** | `audit_ingest_lag_seconds > 30` |
| **Impact** | Audit trail delayed — compliance queries show stale data |

**Triage:**

```
Ingest lag > 30s
├── Is audit-worker healthy?
│   → curl -s http://audit-worker:3004/ops/heartbeat
│   ├── Stale → See FM-01 (worker stalled)
│   └── Fresh → Worker is processing but falling behind
│       ├── Check processing rate vs. incoming rate
│       │   → curl -s http://audit:3004/ops/metrics | grep -E "ingest_rate|process_rate"
│       │   ├── Burst from a specific service (bulk operation)
│       │   │   → Normal during bulk imports. Will catch up.
│       │   └── Sustained high rate → Scale consumer
│       └── Check if source services' outbox relays are batch-flushing
│           → A service restart causes outbox flush (spike)
└── Is it a single source service or all?
    → Check which services have the most pending outbox entries
```

**Commands:**

```bash
# Check ingest lag
curl -s http://audit:3004/ops/metrics | grep audit_ingest_lag_seconds

# Check processing throughput
curl -s http://audit:3004/ops/metrics | grep -E "audit_events_processed_total|audit_events_received_total"

# Check which services have pending outbox entries (check a sample)
for svc in finance hrms payroll identity; do
  echo "=== $svc ===";
  curl -s http://$svc-worker:*/ops/outbox-relay 2>/dev/null | jq '.pendingCount' 2>/dev/null;
done

# Scale audit worker (K8s)
kubectl scale deployment/audit-worker --replicas=3 -n civitasone
```

---

### FM-05: Compliance export failure

| Field | Value |
|-------|-------|
| **Severity** | P3 |
| **Time to act** | < 1 hour |
| **Alert** | `audit_export_failure_total` increasing |
| **Impact** | Compliance reports cannot be generated on demand |

**Commands:**

```bash
# Check export pipeline health
curl -s http://audit:3004/ops/circuit-breakers | jq '.'

# Check @civitasone/render availability
curl -s http://audit:3004/ops/metrics | grep render_circuit

# Check S3/MinIO connectivity
curl -s http://audit:3004/ops/metrics | grep storage_circuit

# Check pending export jobs
psql civitas_audit -c "
  SELECT id, status, created_at, error
  FROM audit.exports
  WHERE status = 'failed'
  ORDER BY created_at DESC LIMIT 10;
"

# Retry a failed export
curl -X POST http://audit-worker:3004/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "audit.export.create", "batchSize": 5}'
```

---

## Rollback

```bash
# Docker
docker pull civitasone/audit-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d audit-service audit-worker

# K8s
kubectl set image deployment/audit-service \
  audit=civitasone/audit-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/audit-worker \
  worker=civitasone/audit-service:$PREVIOUS_TAG -n civitasone

# Verify health post-rollback
curl -s http://audit:3004/health | jq .
```

**CRITICAL:** Never edit an audit event row directly — not even to "fix" a data-entry mistake. The immutability of this table is the entire point. Corrections must be new compensating events, never in-place edits. Migrations are forward-only.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min + chain verification

An audit-service restore is incomplete until the hash chain is proven intact end-to-end.

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh audit --target-time="2026-07-26T02:00:00Z"

# 2. Verify restore integrity
psql civitas_audit -c "SELECT COUNT(*) FROM audit.events WHERE occurred_at > '2026-07-26T01:45:00Z';"

# 3. Re-verify hash chain for every tenant
curl -X POST http://audit:3004/ops/hash-chain-verify-all | jq '.'

# 4. Replay outbox (idempotent)
curl -X POST http://audit-worker:3004/ops/outbox-relay/replay-pending

# 5. Verify all source services' events are flowing in
curl -s http://audit:3004/ops/metrics | grep audit_ingest_lag_seconds

# 6. Verify log retention compliance (≥ 180 days)
psql civitas_audit -c "
  SELECT MIN(occurred_at), MAX(occurred_at),
         EXTRACT(days FROM MAX(occurred_at) - MIN(occurred_at)) as retention_days
  FROM audit.events;
"
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Audit service restored**  
> DB restored to {timestamp}. Hash chain verified intact for all {N} tenants.  
> Outbox replayed. Ingest lag recovering. No audit events lost.  
> CERT-In compliance: log retention confirmed at {N} days.
