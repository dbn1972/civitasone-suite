# Runbook: citizen-service

> **Tier 2** | SLO: 99.9% availability, p95 read < 300 ms, grievance/RTI SLA compliance ≥ 95%  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Citizen Domain Owner | **Escalation:** SRE → Product  
> **Slack:** `#incident-citizen` | **PagerDuty:** `citizen-critical`  

---

## Purpose

Public-facing citizen portal — grievance registration/tracking (CPGRAMS-style), RTI filing/appeals (RTI Act 2005, 30-day statutory deadline), service applications with eligibility checks, fee payments (BBPS), certificate issuance, and SLA-driven auto-escalation. Owns `civitas_citizen`. PII-heavy (Aadhaar, phone, email encrypted via `encryptedText()`).

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_citizen`) | `curl -s http://citizen:3020/ready \| jq .checks.db` | Total outage |
| Redis | `curl -s http://citizen:3020/ready \| jq .checks.cache` | Degraded reads |
| SQS/RabbitMQ | `curl -s http://citizen:3020/ready \| jq .checks.queue` | Writes stop |
| workflow-service | HTTP call for approval orchestration | Application approvals stuck |
| notification-service | Event consumer | Citizens don't receive SMS/email updates |
| finance-service | Fee receipt generation | Fee payments not recorded |

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Citizen Overview | `https://grafana.internal/d/citizen-overview` | Grievance volume, RTI compliance, application rate |
| SLA Compliance | `https://grafana.internal/d/citizen-sla` | Breach rate by category, statutory deadline tracking |
| DLQ Monitor | `https://grafana.internal/d/citizen-dlq` | DLQ depth, failed messages |
| Payment Health | `https://grafana.internal/d/citizen-payments` | BBPS success rate, pending payments |

---

## Failure Modes

### FM-01: SLA sweep not firing (grievances/RTI aging without escalation)

| Field | Value |
|-------|-------|
| **Severity** | P1 (statutory deadlines at risk) |
| **Time to act** | < 15 min |
| **Alert** | `citizen_sla_sweep_last_run_seconds > 3600` |
| **Impact** | Statutory RTI deadlines (30 days) breached without escalation — legal liability |

**Triage:**

```
SLA sweep not running
├── Is the scheduled job active?
│   → curl -s http://admin:3022/v1/admin/scheduled-jobs?service=citizen | jq '.'
│   ├── Job paused → Resume it
│   └── Job active → Check if worker is processing
│       → curl -s http://citizen-worker:3020/ops/consumer-status | jq '.lastProcessedAt'
│       ├── Worker stalled → Restart worker (see FM-02 pattern)
│       └── Worker healthy → Check if SLA topics are being published
│           → The sweep self-publishes: citizen.grievance.sla_check, citizen.rti.sla_check
│           → If not being published, the scheduler isn't triggering
```

**Commands:**

```bash
# Check when SLA sweep last ran
curl -s http://citizen-worker:3020/ops/scheduled-jobs | jq '.[] | select(.name | contains("sla"))'

# Manually trigger SLA sweep (safe — idempotent)
curl -X POST http://citizen-worker:3020/ops/sla-sweep/trigger

# Check how many grievances are past SLA
psql civitas_citizen -c "
  SELECT status, COUNT(*), MIN(created_at) AS oldest
  FROM citizen.grievances
  WHERE status NOT IN ('resolved', 'closed') AND due_at < NOW()
  GROUP BY status;
"

# Check RTI statutory deadline breaches (30 days from filing)
psql civitas_citizen -c "
  SELECT id, filed_at, NOW() - filed_at AS age
  FROM citizen.rti_applications
  WHERE status NOT IN ('responded', 'transferred', 'closed')
  AND filed_at < NOW() - INTERVAL '25 days'
  ORDER BY filed_at;
"
```

**Verification after fix:**

```bash
# Sweep ran recently
curl -s http://citizen-worker:3020/ops/sla-sweep/status | jq '.lastRunAt'

# Escalation events being published
curl -s http://citizen-worker:3020/ops/outbox-relay | jq '.pendingCount'
```

**Communication template:**

> 🟡 **[P1] Citizen SLA sweep delayed**  
> Grievance/RTI escalations paused for {duration}. {N} RTI applications approaching 30-day statutory deadline.  
> Sweep re-triggered. Escalation notifications being sent now.  
> No statutory breach yet if sweep was down < 24h.

---

### FM-02: Payment callback failing (citizen.payment.requested)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `citizen_dlq_depth{topic="citizen.payment.requested"} > 0` |
| **Impact** | Citizens have paid but receipts not generated |

**Commands:**

```bash
# Peek at payment DLQ
curl -s http://citizen-worker:3020/ops/dlq/peek?topic=citizen.payment.requested&limit=5 | jq '.'

# Check BBPS adapter health
curl -s http://citizen:3020/ops/circuit-breakers | jq '.bbps'

# Verify payment was recorded at gateway level
# (citizen pays → BBPS callback → citizen-service records receipt)
psql civitas_citizen -c "
  SELECT id, amount_minor, status, bbps_reference
  FROM citizen.fee_payments
  WHERE created_at > NOW() - INTERVAL '1 hour' AND status = 'pending';
"

# Redrive after fix (payments are idempotent by reference ID)
curl -X POST http://citizen-worker:3020/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "citizen.payment.requested", "batchSize": 10}'
```

---

### FM-03: PII decryption errors

| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **Time to act** | IMMEDIATE |
| **Alert** | `citizen_pii_decryption_error_total > 0` |
| **Impact** | Cannot read citizen data — portal functionally broken |

**Triage:**

```
PII decryption errors
├── Did ENCRYPTION_KEY env var change?
│   → Compare key across all replicas: docker exec <container> env | grep ENCRYPTION_KEY | sha256sum
│   ├── Keys differ across replicas → One replica got wrong env
│   │   → FIX: Ensure all replicas use same key from secret manager
│   └── Key matches but still failing → Key was rotated without re-encryption
│       → CRITICAL: Old data encrypted with old key. New key can't decrypt.
│       → Immediate rollback of the key change.
│       → Use previous key from secret manager version history.
└── Is it ALL records or specific ones?
    ├── All → Key mismatch (see above)
    └── Specific records → Data corruption. Restore those rows from backup.
```

**Commands:**

```bash
# Check encryption key hash consistency across replicas
for pod in $(kubectl get pods -l app=citizen-service -o name); do
  echo "$pod: $(kubectl exec $pod -- printenv ENCRYPTION_KEY | sha256sum | cut -c1-16)"
done

# Test decryption with a known record
psql civitas_citizen -c "
  SELECT id, email_encrypted FROM citizen.profiles LIMIT 1;
" 
# Then verify the service can decrypt it:
curl -s "http://citizen:3020/v1/citizen/profiles/<id>" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data.email'
```

---

## Rollback

```bash
docker pull civitasone/citizen-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d citizen-service citizen-worker

# Verify
curl -s http://citizen:3020/health | jq .
```

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh citizen --target-time="<timestamp>"

# 2. Replay outbox
curl -X POST http://citizen-worker:3020/ops/outbox-relay/replay-pending

# 3. Verify SLA timers are intact (dueAt computed at creation — survives restore)
psql civitas_citizen -c "
  SELECT COUNT(*) FROM citizen.grievances WHERE due_at IS NOT NULL AND status = 'open';
"

# 4. Verify PII decryption works after restore
curl -s "http://citizen:3020/v1/citizen/profiles?limit=1" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data[0].email'

# 5. Re-run SLA sweep (recalculate escalation state)
curl -X POST http://citizen-worker:3020/ops/sla-sweep/trigger

# 6. Check no duplicate certificates were issued
psql civitas_citizen -c "
  SELECT certificate_no, COUNT(*) FROM citizen.certificates
  GROUP BY certificate_no HAVING COUNT(*) > 1;
"
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Citizen portal restored**  
> DB restored to {timestamp}. SLA timers intact. PII decryption verified.  
> RTI statutory deadlines: {N} applications within 30-day window — all escalated.
