# Runbook: contract-service

> **Tier 2** | SLO: 99.9% availability, p95 read < 300 ms, renewal alert delivery ≥ 99%  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Legal/Procurement Domain Owner | **Escalation:** SRE → CTO  
> **Slack:** `#incident-contract` | **PagerDuty:** `contract-critical`  

---

## Purpose

Contract lifecycle management — creation from templates with clause libraries, multi-level approval workflows, activation, amendment tracking (version history), obligation monitoring, renewal management with advance alerts, e-signature (DSC/Aadhaar eSign), and expiry alerting. Manages legally binding documents with statutory deadlines. Missed renewals carry financial penalties. Owns `civitas_contract`.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_contract`) | `curl -s http://contract:3009/ready \| jq .checks.db` | Total outage |
| Redis | `curl -s http://contract:3009/ready \| jq .checks.cache` | Degraded reads (contract status, clause lookups) |
| SQS/RabbitMQ | `curl -s http://contract:3009/ready \| jq .checks.queue` | Contract commands stop |
| Workflow-service (approvals) | `curl -s http://workflow:3029/health` | Multi-level contract approvals stuck |
| @civitasone/render (DSC signing) | `curl -s http://contract:3009/ops/circuit-breakers \| jq .render` | E-signature fails |
| Estab-service (eOffice decisions) | `curl -s http://estab:3010/health` | Contract award file decisions stuck |
| Notification-service (alerts) | `curl -s http://notification:3006/health` | Renewal/expiry alerts not sent |

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Contract Overview | `https://grafana.internal/d/contract-overview` | Contracts by status, renewal pipeline |
| DLQ Monitor | `https://grafana.internal/d/contract-dlq` | DLQ depth by topic |
| E-Sign Status | `https://grafana.internal/d/contract-esign` | Signing completion rate, deadline tracking |
| Obligations | `https://grafana.internal/d/contract-obligations` | Obligation compliance rate, overdue items |

---

## Failure Modes

### FM-01: Renewal alerts not firing (legal/financial exposure)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 15 min |
| **Alert** | `contract_renewal_alert_missed_total` > 0 OR manual report |
| **Impact** | Contracts may auto-expire without renewal — financial penalties, service gaps |

**Triage:**

```
Renewal alerts not firing
├── Is the renewal sweep scheduler running?
│   → curl -s http://contract-worker:3009/ops/heartbeat | jq '.scheduledJobs.renewalSweep'
│   ├── Not running → Worker stalled or job paused
│   │   → Restart worker: docker restart civitasone-contract-worker
│   └── Running → Check if it's finding contracts due for renewal
│       → psql civitas_contract -c "SELECT COUNT(*) FROM contract.contracts
│          WHERE status = 'active' AND renewal_date <= NOW() + INTERVAL '90 days'
│          AND renewal_alert_sent = false;"
│       ├── Count > 0 → Alerts generated but not delivered
│       │   → Check outbox relay: curl -s http://contract-worker:3009/ops/outbox-relay
│       │   → Check notification-service health
│       └── Count = 0 → All alerts already sent (or no renewals due)
└── Was there a gap (scheduler missed a day)?
    → Manually trigger renewal sweep for safety
    → curl -X POST http://contract:3009/ops/renewal-sweep-now
```

**Commands:**

```bash
# Check contracts due for renewal without alert sent
psql civitas_contract -c "
  SELECT id, title, renewal_date, tenant_id,
         renewal_date - CURRENT_DATE as days_remaining
  FROM contract.contracts
  WHERE status = 'active'
  AND renewal_date <= NOW() + INTERVAL '90 days'
  AND renewal_alert_sent = false
  ORDER BY renewal_date LIMIT 20;
"

# Check worker heartbeat and scheduler
curl -s http://contract-worker:3009/ops/heartbeat | jq .

# Force renewal sweep
curl -X POST http://contract:3009/ops/renewal-sweep-now

# Check outbox for pending alert events
curl -s http://contract-worker:3009/ops/outbox-relay | jq '.pendingCount'

# Verify notification-service received the alert
curl -s http://notification:3006/ops/metrics | grep "contract_renewal"
```

**Communication template:**

> 🟡 **[P1] Contract renewal alerts not firing — legal exposure risk**  
> {N} contracts approaching renewal without alert. Closest: {date}.  
> Root cause: {scheduler stalled | outbox stuck | notification-service down}.  
> No contracts have expired yet. Manual sweep triggered.  
> ETR: {10 min for restart | immediate for manual sweep}.

---

### FM-02: E-sign stuck (parties not signing, deadline approaching)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `contract_esign_deadline_approaching` with unsigned parties |
| **Impact** | Contract activation blocked — parties haven't signed |

**Triage:**

```
E-sign stuck
├── Is it a system issue or business issue (parties haven't acted)?
│   ├── Parties notified but haven't signed → Business process. Escalate command fires auto.
│   └── Parties NOT notified → Notification delivery failed
│       → Check notification-service DLQ for e-sign reminders
├── Is the e-sign deadline check running?
│   → curl -s http://contract-worker:3009/ops/heartbeat | jq '.scheduledJobs.esignDeadline'
├── DSC signing infrastructure working?
│   → curl -s http://contract:3009/ops/circuit-breakers | jq '.render'
│   ├── open → @civitasone/render is down. Signatures can't be applied.
│   └── closed → Infrastructure fine. Issue is parties not acting.
└── After deadline, contract auto-escalates. Verify escalation event fires.
```

**Commands:**

```bash
# Find contracts with approaching e-sign deadlines
psql civitas_contract -c "
  SELECT c.id, c.title, es.deadline, es.unsigned_parties,
         es.deadline - NOW() as time_remaining
  FROM contract.contracts c
  JOIN contract.esign_sessions es ON es.contract_id = c.id
  WHERE es.status = 'pending' AND es.deadline < NOW() + INTERVAL '48 hours'
  ORDER BY es.deadline LIMIT 10;
"

# Check DSC/render circuit breaker
curl -s http://contract:3009/ops/circuit-breakers | jq '.render'

# Force deadline check
curl -X POST http://contract:3009/ops/esign-deadline-check

# Check notification delivery for e-sign reminders
curl -s http://notification:3006/ops/metrics | grep "esign_reminder"
```

---

### FM-03: Contract approval stuck in workflow

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | Manual report (contract pending > 7 days) |
| **Impact** | Specific contracts not activating — business operations delayed |

**Commands:**

```bash
# Check workflow instance for the contract
curl -s "http://workflow:3029/v1/workflow/instances?refType=contract_approval&refId={contractId}" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[0]'

# Check which approval level is pending
curl -s "http://workflow:3029/v1/workflow/instances/{instanceId}/steps" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | select(.status == "pending")'

# Check contract approval levels configuration
psql civitas_contract -c "
  SELECT level, approver_role, required_count
  FROM contract.approval_levels
  WHERE contract_type = '{contractType}'
  ORDER BY level;
"

# Check DLQ for approval commands
curl -s http://contract-worker:3009/ops/dlq/peek?topic=contract.contract.approve | jq .
```

---

### FM-04: Consumer stalled (contract-worker)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `contract_worker_heartbeat_stale > 60s` |
| **Impact** | Contract lifecycle commands, renewal sweeps, e-sign checks all stop |

**Commands:**

```bash
# Check worker heartbeat
curl -s http://contract-worker:3009/ops/heartbeat | jq .

# View recent logs
docker logs civitasone-contract-worker --tail=100 --since=5m 2>&1 | grep -E "ERROR|FATAL"

# Restart worker
docker restart civitasone-contract-worker

# Verify recovery
curl -s http://contract-worker:3009/ops/heartbeat | jq '.ageSeconds < 10'
```

**Communication template:**

> 🟡 **[P1] Contract worker stalled — lifecycle commands not processing**  
> Renewal sweeps, e-sign checks, approvals queued safely.  
> Root cause: {OOM | DB | poison message}. ETR: {5 min for restart}.

---

## Rollback

```bash
# Docker
docker pull civitasone/contract-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d contract-service contract-worker

# K8s
kubectl set image deployment/contract-service \
  contract=civitasone/contract-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/contract-worker \
  worker=civitasone/contract-service:$PREVIOUS_TAG -n civitasone

# Verify health
curl -s http://contract:3009/health | jq .
```

**CRITICAL:** Contract state is legally significant. An activated contract cannot be un-activated. Amendments are append-only. E-signatures (PKCS#7) are cryptographically immutable.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh contract --target-time="2026-07-26T02:00:00Z"

# 2. Check for contracts that missed renewal dates during outage
psql civitas_contract -c "
  SELECT id, title, renewal_date FROM contract.contracts
  WHERE renewal_date BETWEEN '2026-07-26T01:45:00Z' AND NOW()
  AND status = 'active' AND renewal_alert_sent = false;
"

# 3. Re-run renewal sweep
curl -X POST http://contract:3009/ops/renewal-sweep-now

# 4. Verify e-sign timestamps intact
psql civitas_contract -c "
  SELECT id, signed_at, signature_hash FROM contract.esign_records
  WHERE signed_at > '2026-07-26T01:45:00Z' LIMIT 10;
"

# 5. Replay outbox
curl -X POST http://contract-worker:3009/ops/outbox-relay/replay-pending

# 6. Check obligation due dates (manual status correction if SLA breached during downtime)
psql civitas_contract -c "
  SELECT id, contract_id, due_date, status FROM contract.obligations
  WHERE due_date BETWEEN '2026-07-26T01:45:00Z' AND NOW()
  AND status = 'pending';
"
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Contract service restored**  
> DB restored to {timestamp}. Renewal sweep re-run — {N} alerts pending.  
> E-sign timestamps intact. Obligations reviewed for SLA compliance.  
> No contracts expired during outage. Audit trail continuous.
