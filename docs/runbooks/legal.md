# Runbook: legal-service

> **Tier 2** | SLO: 99.9% availability, p95 read < 300 ms, limitation tracking accuracy 100%, DLQ = 0  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Legal Domain Owner | **Escalation:** SRE → CTO  
> **Slack:** `#incident-legal` | **PagerDuty:** `legal-critical`  

---

## Purpose

Legal case management — case creation/tracking, hearing scheduling/adjournment, court order recording, legal notice management, contract review/clearance, settlement tracking, opinion drafting/issuance (eOffice approval), counsel brief assignment, filing records, statutory limitation tracking (Limitation Act 1963), document management with legal holds, RTI compliance (30-day statutory SLA), and e-Courts integration. Owns `civitas_legal` on port 3021. If legal is down, limitation deadlines can be missed (case permanently barred — unrecoverable), hearings go unrecorded, RTI responses breach statutory deadlines, and contract reviews block activation.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_legal`) | `curl -s http://legal:3021/ready \| jq .checks.db` | Total outage — all legal operations halt |
| Redis | `curl -s http://legal:3021/ready \| jq .checks.cache` | Degraded reads (case status, limitation countdown) |
| SQS/RabbitMQ | `curl -s http://legal:3021/ready \| jq .checks.queue` | Commands stop processing, events not emitted |
| Estab-service (eOffice) | `curl -s http://estab:3010/health` | Legal opinion approvals stuck |
| Meeting-service (decisions) | `curl -s http://meeting:3033/health` | Board legal decision intake stops |
| Notification-service | `curl -s http://notification:3006/health` | Hearing reminders, limitation alerts not delivered |
| Contract-service (clearance) | `curl -s http://contract:3009/health` | Contract activation blocked on legal clearance |
| e-Courts portal | `curl -s http://legal:3021/ops/circuit-breakers \| jq .ecourts` | Case status sync offline (graceful degrade) |

**Cross-service consumed:** `legal.opinion.file_decided` (estab eOffice callback), `meeting.decision.legal` (board decisions)

**Cross-service produced:** `legal.case.date_set` (→ notification), `legal.contract_review.cleared` (→ contract-service)

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Legal Overview | `https://grafana.internal/d/legal-overview` | Cases by status, hearing calendar, p95 latency |
| DLQ Monitor | `https://grafana.internal/d/legal-dlq` | DLQ depth by topic |
| Limitation Tracker | `https://grafana.internal/d/legal-limitations` | Limitations expiring in 7/30/60/90 days |
| RTI Compliance | `https://grafana.internal/d/legal-rti` | RTI SLA compliance rate, pending responses |
| Contract Review SLA | `https://grafana.internal/d/legal-contract-review` | Review turnaround time, pending clearances |

---

## Failure Modes

### FM-01: Limitation tracking alert not firing (CRITICAL — unrecoverable legal loss)

| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **Time to act** | < 5 min |
| **Alert** | `legal_limitation_expiry_7d_no_action > 0` OR limitation sweep stale > 24h |
| **Impact** | Case permanently barred by time — unrecoverable legal/financial loss |

**Triage:**

```
Limitation alerts not firing
├── Is the limitation sweep scheduler running?
│   → curl -s http://legal:3021/ops/heartbeat | jq '.scheduledJobs.limitationSweep'
│   ├── Not found or stale > 24h → CRITICAL: Sweep has stopped!
│   │   → Immediate: restart worker
│   │   → docker restart civitasone-legal-worker
│   │   → After restart: manually trigger sweep
│   │   → curl -X POST http://legal:3021/ops/limitation-sweep-now
│   └── Running → Sweep executing but not finding or alerting
│       → Check if limitations exist that should trigger
│       → psql civitas_legal -c "SELECT id, case_id, expires_at,
│          expires_at - CURRENT_DATE as days_remaining, alert_sent
│          FROM legal.limitations
│          WHERE expires_at <= NOW() + INTERVAL '30 days'
│          AND alert_sent = false
│          ORDER BY expires_at LIMIT 20;"
│       ├── Records found → Alerts generated but not delivered
│       │   → Check outbox: curl -s http://legal:3021/ops/outbox-relay | jq '.pendingCount'
│       │   → Check notification-service health
│       │   → If outbox stuck: curl -X POST http://legal:3021/ops/outbox-relay/restart
│       └── No records → All limitations already alerted (or none due)
│           → Verify: psql -c "SELECT COUNT(*) FROM legal.limitations WHERE expires_at <= NOW() + INTERVAL '90 days';"
├── Was there a gap (scheduler missed a cycle)?
│   → Check last sweep time vs expected (daily)
│   → If gap: IMMEDIATELY trigger manual sweep — every hour counts
│   → curl -X POST http://legal:3021/ops/limitation-sweep-now
└── Is notification-service delivering?
    → curl -s http://notification:3006/ops/metrics | grep "limitation"
    → If notifications stuck, escalate to notification team SIMULTANEOUSLY
```

**Commands:**

```bash
# CHECK IMMEDIATELY: limitations expiring soon without alert
psql civitas_legal -c "
  SELECT id, case_id, limitation_type, expires_at,
         expires_at - CURRENT_DATE as days_remaining,
         alert_sent, tenant_id
  FROM legal.limitations
  WHERE expires_at <= NOW() + INTERVAL '30 days'
  AND status = 'active'
  AND alert_sent = false
  ORDER BY expires_at
  LIMIT 20;
"

# Check sweep scheduler status
curl -s http://legal:3021/ops/heartbeat | jq '.scheduledJobs.limitationSweep'

# Force immediate limitation sweep
curl -X POST http://legal:3021/ops/limitation-sweep-now

# Check outbox for pending reminder events
psql civitas_legal -c "
  SELECT id, topic, created_at FROM legal.outbox
  WHERE topic LIKE '%reminder%' AND relayed_at IS NULL
  ORDER BY created_at LIMIT 10;
"

# Restart outbox relay
curl -X POST http://legal:3021/ops/outbox-relay/restart

# Check notification delivery
curl -s http://notification:3006/ops/metrics | grep "legal_limitation"

# Verify the worker is alive
docker logs civitasone-legal-worker --tail=50 --since=5m 2>&1 | grep -E "limitation|sweep|ERROR"
```

**Verification after fix:**

```bash
# Sweep ran successfully
curl -s http://legal:3021/ops/heartbeat | jq '.scheduledJobs.limitationSweep.lastRunAt'

# No un-alerted limitations in danger zone
psql civitas_legal -c "
  SELECT COUNT(*) FROM legal.limitations
  WHERE expires_at <= NOW() + INTERVAL '7 days'
  AND alert_sent = false AND status = 'active';
"

# Outbox drained
curl -s http://legal:3021/ops/outbox-relay | jq '.pendingCount == 0'
```

**Communication template:**

> 🔴 **[P0] Legal — Limitation tracking sweep STOPPED**  
> Limitation alerts have not fired for {N} hours. {M} limitations expiring in < 30 days without alert.  
> RISK: Missed limitations = case permanently barred (unrecoverable legal loss).  
> Immediate action: manual sweep triggered. Worker restarted.  
> ESCALATION: Legal domain owner + CTO notified. Every affected case requires manual review.  
> ETR: Sweep restored in {5 min}. Manual case review: {24h}.

---

### FM-02: Legal opinion stuck in eOffice approval

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `legal_opinion_pending_approval_age > 7d` |
| **Impact** | Legal opinions not issued — departments waiting for legal clearance |

**Triage:**

```
Opinion stuck in approval
├── Is it waiting for eOffice decision callback?
│   → psql civitas_legal -c "SELECT o.id, o.subject, o.status, o.eoffice_file_id,
│      o.submitted_at, NOW() - o.submitted_at as pending_duration
│      FROM legal.opinions o
│      WHERE o.status = 'pending_approval'
│      ORDER BY o.submitted_at LIMIT 10;"
│   ├── eoffice_file_id present → Waiting on estab-service callback
│   │   → Check if file was decided in eOffice but callback not received
│   │   → curl -s "http://estab:3010/v1/estab/files/{fileId}/status" -H "Authorization: Bearer $TOKEN"
│   │   ├── File decided but no callback → Event lost
│   │   │   → Check DLQ: curl -s http://legal:3021/ops/dlq/peek?topic=legal.opinion.file_decided
│   │   │   → If in DLQ: redrive
│   │   │   → If not in DLQ: check estab outbox relay
│   │   └── File still pending → Business issue (approver hasn't acted)
│   │       → Not a system issue. Escalate via business process.
│   └── No eoffice_file_id → Opinion not submitted for approval yet
│       → Check if submit_approval command was published
│       → Check outbox for pending legal.opinion.submit_approval
├── Is the legal consumer processing approval callbacks?
│   → curl -s http://legal:3021/ops/consumer-status | jq '.consumers["legal.opinion.file_decided"]'
└── Check DLQ for stuck callbacks
    → curl -s http://legal:3021/ops/dlq/peek?topic=legal.opinion.file_decided&limit=5 | jq .
```

**Commands:**

```bash
# Find opinions stuck in approval
psql civitas_legal -c "
  SELECT id, subject, status, eoffice_file_id, submitted_at,
         NOW() - submitted_at as pending_duration
  FROM legal.opinions
  WHERE status = 'pending_approval'
  ORDER BY submitted_at LIMIT 10;
"

# Check eOffice callback DLQ
curl -s http://legal:3021/ops/dlq/peek?topic=legal.opinion.file_decided&limit=5 | jq .

# Redrive callbacks (safe — idempotent)
curl -X POST http://legal:3021/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "legal.opinion.file_decided", "batchSize": 10}'

# Check estab-service outbox for pending legal callbacks
curl -s http://estab:3010/ops/outbox-relay | jq '.pendingCount'

# Check outbox for pending opinion events
psql civitas_legal -c "
  SELECT id, topic, created_at, error FROM legal.outbox
  WHERE topic LIKE '%opinion%' AND relayed_at IS NULL
  ORDER BY created_at LIMIT 5;
"
```

**Verification after fix:**

```bash
# Opinion status updated
psql civitas_legal -c "
  SELECT id, status, issued_at FROM legal.opinions
  WHERE id = '{opinionId}';
"

# No more long-pending opinions (system-side)
psql civitas_legal -c "
  SELECT COUNT(*) FROM legal.opinions
  WHERE status = 'pending_approval'
  AND eoffice_file_id IS NOT NULL
  AND submitted_at < NOW() - INTERVAL '7 days';
"
```

**Communication template:**

> 🟡 **[P2] Legal — Opinion approval callback missing**  
> {N} opinions pending > 7 days. eOffice file decided but callback not received.  
> Root cause: {DLQ on callback | estab outbox stuck | event lost}.  
> No data integrity risk. Opinions will issue on callback delivery.  
> ETR: {10 min for DLQ redrive | coordinate with estab team}.

---

### FM-03: RTI response approaching 30-day deadline

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 15 min |
| **Alert** | `legal_rti_sla_breach_imminent` (< 3 days to deadline) |
| **Impact** | Statutory RTI deadline breach — legal penalty, compliance violation |

**Triage:**

```
RTI SLA breach imminent
├── Is the RTI SLA sweep running?
│   → curl -s http://legal:3021/ops/heartbeat | jq '.scheduledJobs.rtiSweep'
│   ├── Not running → Restart worker + manual sweep
│   └── Running → Sweep detected the breach-imminent cases
│       → Is notification being delivered to the assigned officer?
│       → Check notification outbox
├── Is the RTI response blocked by a system issue?
│   → psql civitas_legal -c "SELECT id, status, assigned_to, received_at,
│      received_at + INTERVAL '30 days' as deadline,
│      received_at + INTERVAL '30 days' - NOW() as time_remaining
│      FROM legal.rti_applications
│      WHERE status NOT IN ('responded', 'transferred', 'rejected')
│      AND received_at + INTERVAL '30 days' < NOW() + INTERVAL '3 days'
│      ORDER BY time_remaining;"
│   ├── assigned_to NULL → RTI not assigned. Process failure.
│   │   → Escalate to legal domain owner for immediate assignment
│   ├── Status = 'third_party_consult' → Waiting on third party
│   │   → RTI Act allows extended timeline for third-party consultation
│   │   → Verify extension was properly recorded
│   └── Status = 'pending_fee' → Additional fee requested
│       → Clock paused per RTI Act section 7(3). Not a breach.
└── Is this a business issue (officer not responding) or system issue?
    → If officer has been notified multiple times → Escalation needed
    → If notifications not going out → System issue (see FM-01 notification check)
```

**Commands:**

```bash
# Find RTI applications approaching deadline
psql civitas_legal -c "
  SELECT id, application_number, status, assigned_to,
         received_at, received_at + INTERVAL '30 days' as deadline,
         received_at + INTERVAL '30 days' - NOW() as time_remaining
  FROM legal.rti_applications
  WHERE status NOT IN ('responded', 'transferred', 'rejected', 'withdrawn')
  AND received_at + INTERVAL '30 days' < NOW() + INTERVAL '3 days'
  ORDER BY time_remaining;
"

# Force RTI SLA sweep
curl -X POST http://legal:3021/ops/rti-sweep-now

# Check escalation events were published
psql civitas_legal -c "
  SELECT id, topic, created_at FROM legal.outbox
  WHERE topic LIKE '%rti%' AND relayed_at IS NULL
  ORDER BY created_at DESC LIMIT 10;
"

# Check RTI SLA compliance rate
curl -s http://legal:3021/ops/metrics | grep legal_rti_sla_compliance
```

**Verification after fix:**

```bash
# RTI sweep running and alerting
curl -s http://legal:3021/ops/heartbeat | jq '.scheduledJobs.rtiSweep'

# Escalations sent
curl -s http://notification:3006/ops/metrics | grep "rti_escalation"
```

**Communication template:**

> 🟠 **[P1] Legal — RTI statutory deadline imminent**  
> {N} RTI applications within 3 days of 30-day deadline. Assigned officers notified.  
> Root cause: {officer not responding | notification not delivered | unassigned}.  
> Statutory penalty risk if deadline breached. Escalating to department head.  
> ETR: Business process — requires officer action. System healthy.

---

### FM-04: Contract review clearance blocked (downstream contract activation stuck)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `legal_contract_review_pending_age > 5d` |
| **Impact** | Contracts cannot activate — vendor/supplier onboarding blocked |

**Triage:**

```
Contract review stuck
├── Is the review assigned?
│   → psql civitas_legal -c "SELECT id, contract_id, status, assigned_to, created_at
│      FROM legal.contract_reviews
│      WHERE status = 'pending' AND created_at < NOW() - INTERVAL '5 days'
│      ORDER BY created_at;"
│   ├── assigned_to NULL → Review not assigned. Assignment failure.
│   │   → Check if auto-assignment rule exists
│   │   → May need manual assignment
│   └── assigned_to present → Assigned but not acted on
│       → Business issue. Send reminder.
├── Was the clearance event published but not received by contract-service?
│   → psql civitas_legal -c "SELECT * FROM legal.outbox
│      WHERE topic = 'legal.contract_review.cleared' AND relayed_at IS NULL;"
│   → If found: outbox relay stuck. Restart.
└── Is the legal.contract_review.clear command in DLQ?
    → curl -s http://legal:3021/ops/dlq/peek?topic=legal.contract_review.clear | jq .
```

**Commands:**

```bash
# Find pending contract reviews
psql civitas_legal -c "
  SELECT id, contract_id, status, assigned_to, created_at,
         NOW() - created_at as pending_duration
  FROM legal.contract_reviews
  WHERE status = 'pending'
  ORDER BY created_at LIMIT 10;
"

# Check if clearance events are stuck in outbox
psql civitas_legal -c "
  SELECT id, topic, payload, created_at FROM legal.outbox
  WHERE topic = 'legal.contract_review.cleared' AND relayed_at IS NULL;
"

# Restart outbox relay if stuck
curl -X POST http://legal:3021/ops/outbox-relay/restart

# Check DLQ for contract review commands
curl -s http://legal:3021/ops/dlq/peek?topic=legal.contract_review.clear&limit=5 | jq .
```

**Verification after fix:**

```bash
# Clearance event delivered
psql civitas_legal -c "
  SELECT id, topic, relayed_at FROM legal.outbox
  WHERE topic = 'legal.contract_review.cleared'
  ORDER BY created_at DESC LIMIT 5;
"

# Contract-service received the clearance
curl -s "http://contract:3009/v1/contract/contracts/{contractId}" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.legalClearanceStatus'
```

**Communication template:**

> 🟡 **[P2] Legal — Contract review clearance delayed**  
> {N} contracts awaiting legal clearance > 5 days. Contract activation blocked downstream.  
> Root cause: {unassigned | officer not acting | outbox stuck | DLQ}.  
> ETR: {immediate for outbox fix | business process for officer action}.

---

### FM-05: Consumer stalled (legal-worker)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `legal_worker_heartbeat_stale > 60s` |
| **Impact** | ALL legal commands stop — limitation sweeps, RTI SLA checks, hearing records, clearances |

**Commands:**

```bash
# Check worker heartbeat
curl -s http://legal:3021/ops/heartbeat | jq .

# View recent error logs
docker logs civitasone-legal-worker --tail=100 --since=5m 2>&1 | grep -E "ERROR|FATAL|OOM"

# Restart worker
docker restart civitasone-legal-worker

# Verify recovery
sleep 5 && curl -s http://legal:3021/ops/heartbeat | jq '.ageSeconds < 10'

# After restart: immediately run critical sweeps
curl -X POST http://legal:3021/ops/limitation-sweep-now
curl -X POST http://legal:3021/ops/rti-sweep-now

# Check DLQ for messages that caused the crash
curl -s http://legal:3021/ops/dlq | jq '.topics[] | select(.depth > 0)'
```

**Communication template:**

> 🟠 **[P1] Legal worker stalled — commands not processing**  
> Limitation sweeps, RTI SLA checks, hearing records all paused.  
> Root cause: {OOM | poison message | DB connection exhaustion}.  
> Worker restarted. Critical sweeps re-triggered.  
> ETR: {5 min for restart + sweep catch-up}.

---

## Rollback

```bash
# Docker
docker pull civitasone/legal-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d legal-service legal-worker

# K8s
kubectl set image deployment/legal-service \
  legal=civitasone/legal-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/legal-worker \
  worker=civitasone/legal-service:$PREVIOUS_TAG -n civitasone

# Verify health
curl -s http://legal:3021/health | jq .

# Verify critical schedulers resumed
curl -s http://legal:3021/ops/heartbeat | jq '.scheduledJobs'

# Verify consumer processing
curl -s http://legal:3021/ops/consumer-status | jq '.consumers | keys'
```

**CRITICAL:** Legal data is immutable — court orders, filings, notices cannot be altered once recorded. Limitation dates are computed at creation and survive rollback. Never delete legal records.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh legal --target-time="2026-07-26T02:00:00Z"

# 2. IMMEDIATELY: Run limitation sweep (highest priority)
curl -X POST http://legal:3021/ops/limitation-sweep-now

# 3. Check for limitations that expired during downtime
psql civitas_legal -c "
  SELECT id, case_id, limitation_type, expires_at
  FROM legal.limitations
  WHERE expires_at BETWEEN '2026-07-26T01:45:00Z' AND NOW()
  AND status = 'active';
"

# 4. Verify hearing dates not missed
psql civitas_legal -c "
  SELECT h.id, h.case_id, h.scheduled_at, h.outcome
  FROM legal.hearings h
  WHERE h.scheduled_at BETWEEN '2026-07-26T01:45:00Z' AND NOW()
  AND h.outcome IS NULL;
"

# 5. Confirm legal holds intact
psql civitas_legal -c "
  SELECT id, document_id, reason, applied_at FROM legal.document_holds
  WHERE status = 'active' ORDER BY applied_at DESC LIMIT 10;
"

# 6. Run RTI SLA sweep
curl -X POST http://legal:3021/ops/rti-sweep-now

# 7. Replay outbox
curl -X POST http://legal:3021/ops/outbox-relay/replay-pending

# 8. Verify e-Courts sync resumes
curl -s http://legal:3021/ops/circuit-breakers | jq '.ecourts'
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Legal service restored**  
> DB restored to {timestamp}. Limitation sweep run — {N} cases require urgent attention.  
> Hearings during outage: {M} need manual outcome recording.  
> Legal holds intact. RTI SLA sweep complete. Audit trail continuous.  
> e-Courts sync resuming on next circuit-breaker cycle.
