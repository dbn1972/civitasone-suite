# Runbook: finance-service

> **Tier 1** | SLO: 99.9% availability, p95 read < 400 ms, command commit < 5s, DLQ = 0  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Finance Domain Owner | **Escalation:** SRE → CTO  
> **Slack:** `#incident-finance` | **PagerDuty:** `finance-critical`  

---

## Purpose

Double-entry GL, budget/sanction/bill/payment lifecycle (Sanction → Bill → 3-way match → Payment → PFMS), treasury (challans/deposits), GST/TDS, and government-payment-rail integration (PFMS/e-Kuber, TRACES). Owns `civitas_finance`.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_finance`) | `curl -s http://finance:3007/ready \| jq .checks.db` | Total outage |
| Redis | `curl -s http://finance:3007/ready \| jq .checks.cache` | Degraded reads (fallthrough to DB) |
| SQS/RabbitMQ | `curl -s http://finance:3007/ready \| jq .checks.queue` | Writes stop processing |
| PFMS/e-Kuber | `curl -s http://finance:3007/ops/circuit-breakers` | Payment rail offline (queued safely) |
| TRACES (TDS) | Same circuit-breaker endpoint | TDS cert reconciliation paused |

**Cross-service consumed:** `audit.para.pending_recovery`, `payroll.run.approved/finalized`, `procurement.grn.accepted`, `grant.uc.submitted`, `ml.prediction.anomaly_detected`, eOffice file-decision callbacks.

**Cross-service produced:** `finance.sanction.approved`, `finance.bill.passed/mismatch`, `finance.payment.made`, `finance.gl.posted`, `finance.transaction.posted`.

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Finance Overview | `https://grafana.internal/d/finance-overview` | p95 latency, error rate, throughput |
| DLQ Monitor | `https://grafana.internal/d/finance-dlq` | DLQ depth by topic, age of oldest message |
| PFMS/TRACES Status | `https://grafana.internal/d/finance-integrations` | Circuit breaker state, success rate |
| Budget Utilization | `https://grafana.internal/d/finance-budget` | Budget head utilization, sanction pipeline |

---

## Failure Modes

### FM-01: Consumer stalled (finance-worker heartbeat stale)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `finance_worker_heartbeat_stale > 60s` |
| **Impact** | All writes (payments, GL postings, sanctions) stop processing |

**Triage:**

```
Worker heartbeat stale
├── Check worker process alive
│   → ssh finance-worker: `ps aux | grep worker`
│   ├── Process dead → Restart: `systemctl restart finance-worker`
│   └── Process alive → Check DB connectivity
│       → `curl -s http://finance:3007/ready | jq .checks.db`
│       ├── db: unhealthy → Check Postgres (see Postgres runbook)
│       └── db: healthy → Check last processed message
│           → `curl -s http://finance:3007/ops/consumer-status`
│           ├── Stuck on specific message → Inspect DLQ candidate
│           └── No messages arriving → Check SQS/queue health
```

**Commands:**

```bash
# Check worker status
curl -s http://finance-worker:3007/ops/heartbeat | jq .

# Check last processed message timestamp
curl -s http://finance-worker:3007/ops/consumer-status | jq '.lastProcessedAt'

# Restart worker (Docker)
docker restart civitasone-finance-worker

# Restart worker (K8s)
kubectl rollout restart deployment/finance-worker -n civitasone
```

**Verification after fix:**

```bash
# Confirm heartbeat is fresh (< 10s ago)
curl -s http://finance-worker:3007/ops/heartbeat | jq '.ageSeconds < 10'

# Confirm DLQ is not growing
watch -n5 'curl -s http://finance-worker:3007/ops/dlq | jq .depth'
```

---

### FM-02: DLQ filling on `finance.payment.*`

| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **Time to act** | < 5 min |
| **Alert** | `finance_dlq_depth{topic=~"finance.payment.*"} > 0` |
| **Impact** | Payments stuck — financial commitments at risk |

**Triage:**

```
DLQ message → read error field
├── "PFMS_TIMEOUT" / "CONNECTION_REFUSED" / "CIRCUIT_OPEN"
│   → PFMS rail is down. DO NOT redrive until breaker closes.
│   → Check: curl -s http://finance:3007/ops/circuit-breakers | jq .pfms
│   ├── state: "open" → Wait for half-open (30s auto). Monitor.
│   └── state: "closed" → Transient. Safe to redrive batch of 10.
├── "DUPLICATE_PAYMENT" / "IDEMPOTENCY_CONFLICT"
│   → Already processed upstream. Safe to acknowledge/delete.
├── "INSUFFICIENT_SAVINGS" / "DOMAIN_ERROR"
│   → Business rule violation. Do NOT redrive. Fix source data.
│   → Escalate to finance team for budget/sanction correction.
├── "VALIDATION_ERROR" / "ZOD_ERROR"
│   → Poison message from upstream. Fix publisher schema.
│   → Escalate to publishing service team.
└── Unknown error
    → Escalate to finance domain owner within 5 min.
    → DO NOT redrive unknown errors on payment topics.
```

**Commands:**

```bash
# Read DLQ messages (peek without consuming)
curl -s http://finance-worker:3007/ops/dlq/peek?topic=finance.payment.initiate&limit=5 | jq .

# Check PFMS circuit breaker state
curl -s http://finance:3007/ops/circuit-breakers | jq '.pfms'

# Redrive specific messages (ONLY after confirming safe)
# WARNING: Never redrive payment messages without verifying no upstream acceptance
curl -X POST http://finance-worker:3007/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "finance.payment.initiate", "batchSize": 10}'

# Acknowledge/delete processed messages from DLQ
curl -X POST http://finance-worker:3007/ops/dlq/ack \
  -H "Content-Type: application/json" \
  -d '{"messageIds": ["msg-id-1", "msg-id-2"]}'

# Verify no payment was double-submitted to PFMS
psql civitas_finance -c "
  SELECT idempotency_key, status, COUNT(*)
  FROM finance.payments
  WHERE created_at > NOW() - INTERVAL '1 hour'
  GROUP BY idempotency_key, status
  HAVING COUNT(*) > 1;
"
```

**Verification after fix:**

```bash
# DLQ depth back to zero
curl -s http://finance-worker:3007/ops/dlq | jq '.depth == 0'

# Payment events flowing again
curl -s http://finance:3007/ops/metrics | grep finance_payment_processed_total

# No duplicate GL entries
psql civitas_finance -c "
  SELECT voucher_no, COUNT(*) FROM finance.gl_entries
  WHERE posted_at > NOW() - INTERVAL '1 hour'
  GROUP BY voucher_no HAVING COUNT(*) > 2;
"
```

**Communication template:**

> 🔴 **[P0] Finance payment processing halted**  
> DLQ depth: {N} messages on `finance.payment.*`. Root cause: {PFMS_TIMEOUT | VALIDATION | UNKNOWN}.  
> Double-spend guard active — no duplicate payments possible.  
> ETR: {15 min if PFMS transient | 1h if data fix needed}.

---

### FM-03: PFMS/TRACES circuit breaker open

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | Monitor (auto-recovers in 30s) |
| **Alert** | `finance_circuit_breaker_state{service="pfms"} == "open"` |
| **Impact** | Payment rail paused — commands queue safely |

**Triage:**

```
Circuit breaker open
├── Check government rail status (external)
│   → PFMS: https://pfms.nic.in (check if portal is accessible)
│   → TRACES: https://www.tdscpc.gov.in
├── Is this a maintenance window?
│   ├── Yes → Monitor. Commands queue. Auto-retries when rail recovers.
│   └── No → Check if our credentials/IP are blocked
│       → Review last 5 PFMS responses in structured logs:
│       → `grep "pfms" /var/log/finance-service/*.log | tail -5`
└── Breaker stays open > 5 min?
    → Escalate to PFMS liaison / NIC contact
    → Payment commands are safe (idempotency key prevents double-submission on retry)
```

**Commands:**

```bash
# Check circuit breaker state and failure count
curl -s http://finance:3007/ops/circuit-breakers | jq '.'

# Check last PFMS call response
curl -s http://finance:3007/ops/integration-health/pfms | jq '.lastResponse'

# Force half-open (ONLY if you've confirmed external service is back)
# WARNING: This bypasses the safety window — use sparingly
curl -X POST http://finance:3007/ops/circuit-breakers/pfms/half-open
```

**Do NOT:**
- Do NOT manually force-close the breaker
- Do NOT redrive DLQ messages while breaker is open
- Do NOT bypass the breaker by calling PFMS directly (breaks idempotency tracking)

---

### FM-04: p95 read latency high (> 400ms)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `finance_http_request_duration_seconds{quantile="0.95"} > 0.4` |
| **Impact** | Slow UI for finance officers; dashboard timeouts |

**Triage:**

```
High read latency
├── Check Redis hit ratio
│   → curl -s http://finance:3007/ops/metrics | grep cache_hit_ratio
│   ├── Hit ratio < 70% → Cache under pressure
│   │   → Check Redis memory: redis-cli INFO memory | grep used_memory_human
│   │   → Check eviction rate: redis-cli INFO stats | grep evicted_keys
│   │   → If evictions high → Increase Redis maxmemory or scale
│   └── Hit ratio > 90% → Issue is DB-side
│       → Check slow queries:
│       → psql civitas_finance -c "SELECT * FROM pg_stat_activity
│          WHERE state = 'active' AND query_start < NOW() - INTERVAL '1s';"
│       ├── Aggregation queries (financial-statements/dashboard)
│       │   → Expected for complex reports. Consider async generation.
│       └── Simple queries slow → Check connection pool
│           → curl -s http://finance:3007/ops/metrics | grep db_pool
│           → If pool exhausted → Check for connection leaks
```

**Commands:**

```bash
# Check cache hit ratio
curl -s http://finance:3007/ops/metrics | grep -E "cache_hit_ratio|cache_miss"

# Check Redis memory pressure
redis-cli -p 6381 INFO memory | grep -E "used_memory_human|maxmemory_human"

# Check active slow queries
psql civitas_finance -c "
  SELECT pid, NOW() - query_start AS duration, query
  FROM pg_stat_activity
  WHERE state = 'active' AND query_start < NOW() - INTERVAL '500ms'
  ORDER BY duration DESC LIMIT 10;
"

# Check DB connection pool utilization
curl -s http://finance:3007/ops/metrics | grep -E "db_pool_size|db_pool_used"

# Kill a specific long-running query (if blocking)
psql civitas_finance -c "SELECT pg_terminate_backend(<pid>);"
```

---

### FM-05: GL mismatch (finance.bill.mismatch)

| Field | Value |
|-------|-------|
| **Severity** | P3 (business flow, not system failure) |
| **Time to act** | N/A (expected behavior) |
| **Alert** | `finance_three_way_mismatch_total` increasing |

This is expected business-flow output — 3-way match (PO-GRN-Invoice) found a quantity/price variance. Verify:

```bash
# Check mismatch event was routed to approval workflow
curl -s "http://workflow:3029/v1/workflow/instances?refType=bill_mismatch&status=active" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'

# If mismatches pile up without workflow instances, check event propagation
curl -s http://finance-worker:3007/ops/outbox-relay | jq '.pendingCount'
```

---

### FM-06: Outbox relay failing

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `finance_outbox_pending_count > 100` for 5 min |
| **Impact** | Events stop propagating to downstream services (audit, workflow, analytics) |

**Commands:**

```bash
# Check outbox relay status
curl -s http://finance-worker:3007/ops/outbox-relay | jq '.'

# Check pending outbox entries count
psql civitas_finance -c "
  SELECT topic, COUNT(*), MIN(created_at) AS oldest
  FROM finance.outbox WHERE relayed_at IS NULL
  GROUP BY topic ORDER BY oldest;
"

# Check DB + SQS connectivity (both needed for relay)
curl -s http://finance:3007/ready | jq '.'

# If relay is stuck on a specific entry, inspect it
psql civitas_finance -c "
  SELECT id, topic, payload, created_at, error
  FROM finance.outbox WHERE relayed_at IS NULL
  ORDER BY created_at LIMIT 5;
"

# Force relay restart (safe — relay is idempotent)
curl -X POST http://finance-worker:3007/ops/outbox-relay/restart
```

---

## Rollback

```bash
# Redeploy previous image (Docker)
docker pull civitasone/finance-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d finance-service finance-worker

# Redeploy previous image (K8s)
kubectl set image deployment/finance-service \
  finance=civitasone/finance-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/finance-worker \
  worker=civitasone/finance-service:$PREVIOUS_TAG -n civitasone
```

**Caution:** Migrations are forward-only. Never auto-rollback schema. GL/ledger schema changes require restore-from-backup rather than destructive rollback.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh finance --target-time="2026-07-26T02:00:00Z"

# 2. Verify restore integrity
psql civitas_finance -c "SELECT COUNT(*) FROM finance.gl_entries WHERE posted_at > '2026-07-26T01:45:00Z';"

# 3. Replay outbox (idempotent — safe to replay)
curl -X POST http://finance-worker:3007/ops/outbox-relay/replay-pending

# 4. Verify audit continuity (no gaps in audit trail)
curl -s "http://audit:3004/v1/audit/events?service=finance&since=2026-07-26T01:00:00Z" \
  -H "Authorization: Bearer $TOKEN" | jq '.meta.total'

# 5. Run trial-balance check (financial integrity)
curl -s "http://finance:3007/v1/finance/statements/trial-balance-check" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.balanced'

# 6. Verify PFMS reconciliation (any payments during gap)
psql civitas_finance -c "
  SELECT id, status, pfms_reference FROM finance.payments
  WHERE created_at BETWEEN '2026-07-26T01:45:00Z' AND NOW()
  AND status = 'pending';
"
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Finance service restored**  
> DB restored to {timestamp}. Trial balance verified: balanced.  
> Outbox replayed. Audit trail continuous. {N} pending payments re-queued for PFMS.  
> No data loss confirmed.
