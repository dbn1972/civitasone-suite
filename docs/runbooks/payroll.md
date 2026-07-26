# Runbook: payroll-service

> **Tier 1** | SLO: 99.9% availability, p95 read < 500 ms, payroll run within SLA window, DLQ = 0  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** HR/Payroll Domain Owner | **Escalation:** Finance Owner → SRE → CTO  
> **Slack:** `#incident-payroll` | **PagerDuty:** `payroll-critical`  

---

## Purpose

Payroll structure/component configuration, monthly run compute/approve/disburse, loans, tax declarations (old/new regime), NACH bank-file return processing, full-and-final (F&F) settlement, Form-16 bulk generation, and pensioner monthly computation. Bigint paise throughout (highest-stakes precision surface). Owns `civitas_payroll` (184 tests).

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_payroll`) | `curl -s http://payroll:3013/ready \| jq .checks.db` | Total outage |
| Redis | `curl -s http://payroll:3013/ready \| jq .checks.cache` | Degraded reads |
| SQS/RabbitMQ | `curl -s http://payroll:3013/ready \| jq .checks.queue` | Run commands stop processing |
| NACH/APBS (bank rail) | `curl -s http://payroll:3013/ops/circuit-breakers \| jq .nach` | Disbursement paused (queued safely) |
| DSC certificates (S3/MinIO) | `curl -s http://payroll:3013/ops/circuit-breakers \| jq .dsc` | Form-16/payslip signing fails |
| HRMS-service (employee data) | `curl -s http://hrms:3012/health` | Run compute can't fetch employee details |
| Finance-service (payment confirm) | `curl -s http://finance:3007/health` | Disbursement confirmation delayed |

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Payroll Overview | `https://grafana.internal/d/payroll-overview` | p95 latency, run status, error rate |
| DLQ Monitor | `https://grafana.internal/d/payroll-dlq` | DLQ depth (especially disburse topic) |
| NACH/Bank | `https://grafana.internal/d/payroll-nach` | NACH success rate, return processing |
| Run Progress | `https://grafana.internal/d/payroll-runs` | Active runs, SLA countdown, completion % |

---

## Failure Modes

### FM-01: DLQ filling on `payroll.run.disburse` (CRITICAL — double-spend risk)

| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **Time to act** | < 5 min |
| **Alert** | `payroll_dlq_depth{topic="payroll.run.disburse"} > 0` |
| **Impact** | Employee salaries stuck — financial integrity at risk |

**Triage:**

```
DLQ on payroll.run.disburse
├── Read error field from DLQ message
│   ├── "NACH_TIMEOUT" / "CIRCUIT_OPEN"
│   │   → Bank rail is down. DO NOT redrive until breaker closes.
│   │   → Check: curl -s http://payroll:3013/ops/circuit-breakers | jq .nach
│   │   ├── state: "open" → Wait for half-open (30s auto)
│   │   └── state: "closed" → Safe to redrive (batch of 5, NOT all at once)
│   ├── "DUPLICATE_DISBURSEMENT" / "IDEMPOTENCY_CONFLICT"
│   │   → Already disbursed upstream. VERIFY before acknowledging:
│   │   → psql civitas_payroll -c "SELECT idempotency_key, status
│   │      FROM payroll.disbursements WHERE run_id = '{runId}';"
│   │   → If status = 'disbursed' → Safe to acknowledge DLQ entry
│   ├── "INSUFFICIENT_BUDGET" / "DOMAIN_ERROR"
│   │   → Budget not allocated. Escalate to Finance team.
│   │   → DO NOT redrive. Fix source data first.
│   └── Unknown error
│       → Escalate to Payroll + Finance domain owners within 5 min
│       → DO NOT redrive unknown errors on disbursement topics
└── BEFORE any redrive: verify no double-disbursement
    → psql civitas_payroll -c "SELECT idempotency_key, COUNT(*)
       FROM payroll.disbursements WHERE run_id = '{runId}'
       GROUP BY idempotency_key HAVING COUNT(*) > 1;"
```

**Commands:**

```bash
# Peek DLQ messages
curl -s http://payroll-worker:3013/ops/dlq/peek?topic=payroll.run.disburse&limit=5 | jq .

# Check NACH circuit breaker
curl -s http://payroll:3013/ops/circuit-breakers | jq '.nach'

# Verify no double-disbursement BEFORE redriving
psql civitas_payroll -c "
  SELECT idempotency_key, status, COUNT(*)
  FROM payroll.disbursements
  WHERE created_at > NOW() - INTERVAL '2 hours'
  GROUP BY idempotency_key, status
  HAVING COUNT(*) > 1;
"

# Redrive ONLY after confirming safe (small batch)
curl -X POST http://payroll-worker:3013/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "payroll.run.disburse", "batchSize": 5}'

# Check run status
psql civitas_payroll -c "
  SELECT id, status, total_employees, disbursed_count, created_at
  FROM payroll.runs
  WHERE status = 'disbursing'
  ORDER BY created_at DESC LIMIT 5;
"
```

**Verification after fix:**

```bash
# DLQ depth zero
curl -s http://payroll-worker:3013/ops/dlq | jq '.depth == 0'

# Run completed
psql civitas_payroll -c "SELECT id, status FROM payroll.runs WHERE status = 'disbursing';"

# Gross/net totals reconcile
psql civitas_payroll -c "
  SELECT run_id, SUM(gross_minor), SUM(net_pay_minor)
  FROM payroll.payslips
  WHERE run_id = '{runId}'
  GROUP BY run_id;
"
```

**Communication template:**

> 🔴 **[P0] Payroll disbursement halted**  
> DLQ depth: {N} on `payroll.run.disburse`. Root cause: {NACH timeout | budget error | unknown}.  
> Double-spend guard active. No duplicate payments possible.  
> ETR: {15 min if NACH transient | 1h if budget fix needed}.

---

### FM-02: Consumer stalled mid-run (SLA window at risk)

| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **Time to act** | IMMEDIATE (< 5 min) |
| **Alert** | `payroll_worker_heartbeat_stale > 60s` AND active run exists |
| **Impact** | Payroll run may miss SLA window — employee salaries delayed |

**Triage:**

```
Worker stalled with active run
├── Check worker process
│   → docker ps --filter "name=payroll-worker"
│   ├── Dead → Restart immediately (SLA clock is ticking)
│   └── Alive → Check if stuck on a specific computation
│       → curl -s http://payroll-worker:3013/ops/consumer-status | jq .
│       → Common: large department run with 10K+ employees
│       → Check DB for long-running queries
│       → psql civitas_payroll -c "SELECT * FROM pg_stat_activity
│          WHERE state='active' AND query_start < NOW() - INTERVAL '30s';"
├── How much time left in SLA window?
│   → Check run creation time vs. SLA deadline
│   → If < 2h remaining: escalate immediately regardless of root cause
└── Can run be resumed after restart?
    → Yes — run compute is idempotent per employee (checks processed flag)
    → Restart worker. It will pick up where it left off.
```

**Commands:**

```bash
# Check worker heartbeat
curl -s http://payroll-worker:3013/ops/heartbeat | jq .

# Check active runs and their progress
psql civitas_payroll -c "
  SELECT id, status, total_employees, computed_count, 
         NOW() - created_at AS elapsed
  FROM payroll.runs
  WHERE status IN ('computing', 'disbursing')
  ORDER BY created_at DESC;
"

# Restart worker (run resumes automatically — idempotent)
docker restart civitasone-payroll-worker

# Monitor run progress after restart
watch -n10 'psql civitas_payroll -c "SELECT id, computed_count, total_employees FROM payroll.runs WHERE status = '\''computing'\'';"'
```

**Communication template:**

> 🔴 **[P0] Payroll worker stalled — active run at SLA risk**  
> Run {runId}: {computed}/{total} employees processed. Worker stalled.  
> SLA window remaining: {hours}h. Root cause: {OOM | stuck query | DB lock}.  
> Run will resume on restart (idempotent). ETR: {5 min for restart}.

---

### FM-03: NACH circuit breaker open

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | Monitor (auto-recovers in 30s) |
| **Alert** | `payroll_circuit_breaker_state{service="nach"} == "open"` |
| **Impact** | Bank file disbursements paused — commands queue safely |

**Commands:**

```bash
# Check circuit breaker state
curl -s http://payroll:3013/ops/circuit-breakers | jq '.nach'

# Check NACH adapter config
docker exec civitasone-payroll env | grep NACH_ENABLED

# Monitor auto-recovery
watch -n10 'curl -s http://payroll:3013/ops/circuit-breakers | jq .nach.state'

# Force half-open (ONLY if bank confirmed operational)
curl -X POST http://payroll:3013/ops/circuit-breakers/nach/half-open
```

**Do NOT:**
- Force-close the breaker
- Redrive DLQ while breaker is open
- Manually call bank APIs outside the system (breaks idempotency tracking)

---

### FM-04: DSC signing failure (Form-16/payslip generation)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `payroll_dsc_signing_error_total` increasing |
| **Impact** | Form-16 bulk generation / payslip PDF signing blocked |

**Commands:**

```bash
# Check DSC circuit breaker
curl -s http://payroll:3013/ops/circuit-breakers | jq '.dsc'

# Check for expiry warnings
docker logs civitasone-payroll --since=24h 2>&1 | grep "dsc.expiry_warning"

# Check DSC certificate details
curl -s http://payroll:3013/ops/dsc-status | jq '.'

# Check S3/MinIO connectivity (certificates stored there)
curl -s http://payroll:3013/ops/circuit-breakers | jq '.storage'

# Retry bulk generation after DSC fix
curl -X POST http://payroll-worker:3013/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "payroll.form16.bulk_generate", "batchSize": 10}'
```

---

### FM-05: Bigint overflow / precision-loss symptoms

| Field | Value |
|-------|-------|
| **Severity** | P0 (CORRECTNESS) |
| **Time to act** | IMMEDIATE |
| **Alert** | Manual detection (gross ≠ sum of components, net mismatch) |
| **Impact** | Incorrect salary calculations — financial integrity compromised |

**Commands:**

```bash
# Check for run total mismatches
psql civitas_payroll -c "
  SELECT r.id, r.total_gross_minor,
         SUM(p.gross_minor) as computed_gross,
         r.total_gross_minor - SUM(p.gross_minor) as diff
  FROM payroll.runs r
  JOIN payroll.payslips p ON p.run_id = r.id
  WHERE r.created_at > NOW() - INTERVAL '7 days'
  GROUP BY r.id, r.total_gross_minor
  HAVING r.total_gross_minor != SUM(p.gross_minor);
"

# Check for any number (non-bigint) columns that should be bigint
psql civitas_payroll -c "
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'payroll'
  AND column_name LIKE '%_minor'
  AND data_type != 'bigint';
"

# This is a CODE BUG, not infra. Escalate to engineering.
# Verify: no code path casts *_minor bigint to number
grep -r "Number(" services/payroll-service/src/ | grep "_minor"
```

**Communication template:**

> 🔴 **[P0 — CORRECTNESS] Payroll precision error detected**  
> Run {runId} gross/net totals do not reconcile. Potential bigint→number cast.  
> Disbursement HALTED pending verification. No incorrect payments made yet.  
> Engineering investigating code path. ETR: depends on bug complexity.

---

## Rollback

```bash
# Docker
docker pull civitasone/payroll-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d payroll-service payroll-worker

# K8s
kubectl set image deployment/payroll-service \
  payroll=civitasone/payroll-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/payroll-worker \
  worker=civitasone/payroll-service:$PREVIOUS_TAG -n civitasone

# Verify health
curl -s http://payroll:3013/health | jq .
```

**CRITICAL:** Never manually "correct" a disbursed run's totals via direct DB update. Use `payroll.run.revert` command so the audit trail stays intact.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh payroll --target-time="2026-07-26T02:00:00Z"

# 2. Verify run totals reconcile (gross/net/PF/GPF/NPS/ESI/TDS)
psql civitas_payroll -c "
  SELECT r.id, r.status, r.total_gross_minor, r.total_net_minor,
         SUM(p.gross_minor) as sum_gross, SUM(p.net_pay_minor) as sum_net
  FROM payroll.runs r
  JOIN payroll.payslips p ON p.run_id = r.id
  WHERE r.created_at > '2026-07-26T01:00:00Z'
  GROUP BY r.id, r.status, r.total_gross_minor, r.total_net_minor;
"

# 3. Replay outbox
curl -X POST http://payroll-worker:3013/ops/outbox-relay/replay-pending

# 4. Verify audit continuity
curl -s "http://audit:3004/v1/audit/events?service=payroll&since=2026-07-26T01:00:00Z" \
  -H "Authorization: Bearer $TOKEN" | jq '.meta.total'

# 5. Check for runs stuck mid-disburse (need manual intervention)
psql civitas_payroll -c "
  SELECT id, status, disbursed_count, total_employees
  FROM payroll.runs
  WHERE status = 'disbursing' AND created_at > '2026-07-26T01:45:00Z';
"

# 6. Verify NACH reconciliation (any payments during gap)
psql civitas_payroll -c "
  SELECT id, status, nach_reference
  FROM payroll.disbursements
  WHERE created_at BETWEEN '2026-07-26T01:45:00Z' AND NOW()
  AND status = 'pending';
"
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Payroll service restored**  
> DB restored to {timestamp}. Run totals verified (gross/net reconciled).  
> Outbox replayed. {N} pending disbursements re-queued.  
> No duplicate payments confirmed. Audit trail continuous.
