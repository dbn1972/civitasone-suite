# Runbook: grant-service

> **Tier 2** | SLO: 99.9% availability, p95 read < 300 ms, zero double-disbursement, zero UC gate bypass  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Grant/Subsidy Domain Owner | **Escalation:** Finance Owner → SRE → CTO  
> **Slack:** `#incident-grant` | **PagerDuty:** `grant-critical`  

---

## Purpose

Government grant/subsidy management — scheme definition with eligibility criteria, application processing (scoring + approval/rejection), beneficiary management (bank account linkage, Aadhaar seeding), installment-based disbursement (maker-checker + UC gate enforcement), PFMS reconciliation, utilisation certificate submission/validation, and compliance reporting. Handles government money disbursement to beneficiaries — financial integrity paramount. All amounts in BigInt paise. Owns `civitas_grant`.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_grant`) | `curl -s http://grant:3019/ready \| jq .checks.db` | Total outage |
| Redis | `curl -s http://grant:3019/ready \| jq .checks.cache` | Degraded reads (scheme/beneficiary lookups) |
| SQS/RabbitMQ | `curl -s http://grant:3019/ready \| jq .checks.queue` | Disbursement/application commands stop |
| PFMS (circuit-breaker) | `curl -s http://grant:3019/ops/circuit-breakers \| jq .pfms` | DBT verification paused |
| Finance-service (payment) | `curl -s http://finance:3007/health` | Payment execution confirmation delayed |
| Project-service (milestones) | `curl -s http://project:3014/health` | UC gate milestone checks fail |
| Estab-service (eOffice) | `curl -s http://estab:3010/health` | Disbursement approval files stuck |

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Grant Overview | `https://grafana.internal/d/grant-overview` | Scheme utilization, disbursement pipeline |
| DLQ Monitor | `https://grafana.internal/d/grant-dlq` | DLQ depth (disbursement topics = CRITICAL) |
| UC Compliance | `https://grafana.internal/d/grant-uc` | UC submission rate, validation status |
| Beneficiary Coverage | `https://grafana.internal/d/grant-beneficiary` | Beneficiary count, Aadhaar seeding rate |

---

## Failure Modes

### FM-01: Disbursement stuck (UC gate blocked)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 15 min |
| **Alert** | `grant_disbursement_blocked_uc_gate` > threshold |
| **Impact** | Beneficiaries not receiving next installment — scheme delivery blocked |

**Triage:**

```
Disbursement blocked by UC gate
├── Check UC status for the previous installment
│   → psql civitas_grant -c "SELECT installment_no, uc_status, submitted_at
│      FROM grant.installments WHERE application_id = '{appId}'
│      ORDER BY installment_no;"
│   ├── uc_status: "pending" → UC not submitted yet
│   │   → Business issue — beneficiary needs to submit UC
│   │   → Notify beneficiary via notification-service
│   ├── uc_status: "submitted" → UC submitted but not validated
│   │   → Check UC validation consumer
│   │   → curl -s http://grant-worker:3019/ops/dlq/peek?topic=grant.uc.validate
│   │   ├── In DLQ → Validation failed. Check error.
│   │   └── Not in DLQ → Consumer lag. Check worker heartbeat.
│   ├── uc_status: "rejected" → UC was rejected
│   │   → Beneficiary must re-submit. Business process.
│   └── uc_status: "validated" → Gate should be open!
│       → BUG: gate check not reading latest status
│       → Check cache: redis-cli GET "grant:{tenant}:uc:{installmentId}"
│       → Force cache invalidation
├── Is project milestone required? (project-service)
│   → curl -s "http://project:3014/v1/projects/{projectId}/milestones/{milestoneId}"
│   → If milestone not completed → Blocking condition is valid
└── Was an eOffice approval file raised?
    → Check estab-service for the disbursement approval file decision
```

**Commands:**

```bash
# Check installment and UC status
psql civitas_grant -c "
  SELECT i.installment_no, i.amount_minor, i.status, i.uc_status,
         i.uc_submitted_at, i.uc_validated_at
  FROM grant.installments i
  WHERE i.application_id = '{applicationId}'
  ORDER BY i.installment_no;
"

# Check UC validation DLQ
curl -s http://grant-worker:3019/ops/dlq/peek?topic=grant.uc.validate&limit=5 | jq .

# Force cache invalidation for UC status
redis-cli -p 6381 DEL "grant:{tenantId}:uc:{installmentId}"

# Check grant-worker heartbeat
curl -s http://grant-worker:3019/ops/heartbeat | jq .

# Check project milestone status
curl -s "http://project:3014/v1/projects/{projectId}/milestones" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | select(.id == "{milestoneId}")'
```

**Communication template:**

> 🟡 **[P1] Grant disbursement blocked — UC gate not clearing**  
> Application {appId}: installment {N} blocked. UC status: {status}.  
> Root cause: {UC not submitted | validation failed | cache stale | milestone pending}.  
> No incorrect disbursements possible (gate enforced). ETR: depends on cause.

---

### FM-02: DLQ on `grant.disbursement.initiate` (money flow at stake)

| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **Time to act** | < 5 min |
| **Alert** | `grant_dlq_depth{topic="grant.disbursement.initiate"} > 0` |
| **Impact** | Beneficiary payments stuck — government scheme delivery at risk |

**Triage:**

```
DLQ on disbursement
├── Read error field
│   ├── "BANK_ACCOUNT_NOT_LINKED"
│   │   → Beneficiary hasn't linked bank account (required for DBT)
│   │   → Business issue. Notify beneficiary. DO NOT redrive.
│   ├── "AADHAAR_NOT_SEEDED"
│   │   → Some schemes require Aadhaar verification
│   │   → Check scheme config. If Aadhaar is optional, may be a bug.
│   ├── "BUDGET_EXCEEDED"
│   │   → Scheme budget ceiling hit. New disbursements blocked.
│   │   → Escalate to scheme admin for budget revision.
│   ├── "DUPLICATE_DISBURSEMENT" / "IDEMPOTENCY_CONFLICT"
│   │   → Already disbursed. VERIFY then acknowledge.
│   │   → psql: SELECT idempotency_key, status FROM grant.disbursements WHERE ...
│   ├── "PFMS_CIRCUIT_OPEN"
│   │   → PFMS is down. DO NOT redrive until breaker closes.
│   └── Unknown → Escalate within 5 min. Money flow at stake.
└── BEFORE any redrive: verify no double-disbursement
    → psql: SELECT application_id, installment_no, COUNT(*) FROM grant.disbursements
       WHERE created_at > NOW() - INTERVAL '2h' GROUP BY 1,2 HAVING COUNT(*) > 1;
```

**Commands:**

```bash
# Peek DLQ
curl -s http://grant-worker:3019/ops/dlq/peek?topic=grant.disbursement.initiate&limit=5 | jq .

# Check for double-disbursement (BEFORE redrive)
psql civitas_grant -c "
  SELECT application_id, installment_no, idempotency_key, COUNT(*)
  FROM grant.disbursements
  WHERE created_at > NOW() - INTERVAL '2 hours'
  GROUP BY application_id, installment_no, idempotency_key
  HAVING COUNT(*) > 1;
"

# Check PFMS circuit breaker
curl -s http://grant:3019/ops/circuit-breakers | jq '.pfms'

# Check scheme budget
psql civitas_grant -c "
  SELECT s.id, s.name, s.budget_minor, s.utilized_minor,
         s.budget_minor - s.utilized_minor as remaining_minor
  FROM grant.schemes s
  WHERE s.id = '{schemeId}';
"

# Redrive (ONLY transient errors, small batch)
curl -X POST http://grant-worker:3019/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "grant.disbursement.initiate", "batchSize": 5}'
```

**Communication template:**

> 🔴 **[P0] Grant disbursement processing halted**  
> DLQ depth: {N}. Root cause: {budget exceeded | bank not linked | PFMS down}.  
> Double-spend guard active. No duplicate payments possible.  
> Beneficiary payments delayed. ETR: {15 min if transient | escalation if budget}.

---

### FM-03: PFMS reconciliation failing

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | Monitor (circuit breaker handles) |
| **Alert** | `grant_circuit_breaker_state{service="pfms"} == "open"` |
| **Impact** | DBT verification paused — disbursements queue safely |

**Commands:**

```bash
# Check PFMS circuit breaker
curl -s http://grant:3019/ops/circuit-breakers | jq '.pfms'

# Check PFMS config
docker exec civitasone-grant env | grep PFMS_ENABLED

# Check reconciliation status
psql civitas_grant -c "
  SELECT status, COUNT(*) FROM grant.pfms_reconciliation
  WHERE created_at > NOW() - INTERVAL '24 hours'
  GROUP BY status;
"

# Monitor auto-recovery
watch -n10 'curl -s http://grant:3019/ops/circuit-breakers | jq .pfms.state'
```

---

### FM-04: Consumer stalled (grant-worker)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `grant_worker_heartbeat_stale > 60s` |
| **Impact** | Disbursements, UC validations, application processing all stop |

**Commands:**

```bash
# Check worker heartbeat
curl -s http://grant-worker:3019/ops/heartbeat | jq .

# Restart worker
docker restart civitasone-grant-worker

# Verify recovery
curl -s http://grant-worker:3019/ops/heartbeat | jq '.ageSeconds < 10'

# Check DLQ
curl -s http://grant-worker:3019/ops/dlq | jq .depth
```

---

## Rollback

```bash
# Docker
docker pull civitasone/grant-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d grant-service grant-worker

# K8s
kubectl set image deployment/grant-service \
  grant=civitasone/grant-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/grant-worker \
  worker=civitasone/grant-service:$PREVIOUS_TAG -n civitasone

# Verify health
curl -s http://grant:3019/health | jq .
```

**CRITICAL:** Disbursement records are append-only and idempotent. Never delete — issue reversal entries for reclamation.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh grant --target-time="2026-07-26T02:00:00Z"

# 2. Reconcile disbursements against PFMS
psql civitas_grant -c "
  SELECT id, status, pfms_reference, amount_minor
  FROM grant.disbursements
  WHERE created_at BETWEEN '2026-07-26T01:45:00Z' AND NOW()
  AND status = 'pending';
"

# 3. Verify UC gate states accurate
psql civitas_grant -c "
  SELECT application_id, installment_no, uc_status
  FROM grant.installments
  WHERE uc_validated_at > '2026-07-26T01:45:00Z';
"

# 4. Verify scheme budget counters match actual disbursements
psql civitas_grant -c "
  SELECT s.id, s.utilized_minor,
         SUM(d.amount_minor) as actual_disbursed
  FROM grant.schemes s
  LEFT JOIN grant.disbursements d ON d.scheme_id = s.id AND d.status = 'completed'
  GROUP BY s.id, s.utilized_minor
  HAVING s.utilized_minor != SUM(d.amount_minor);
"

# 5. Replay outbox
curl -X POST http://grant-worker:3019/ops/outbox-relay/replay-pending

# 6. Verify audit continuity
curl -s "http://audit:3004/v1/audit/events?service=grant&since=2026-07-26T01:00:00Z" \
  -H "Authorization: Bearer $TOKEN" | jq '.meta.total'
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Grant service restored**  
> DB restored to {timestamp}. Disbursement reconciliation: {N} pending re-queued.  
> UC gate states verified. Scheme budget counters reconciled.  
> No duplicate disbursements. Audit trail continuous.
