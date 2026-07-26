# Runbook: court-service

> **Tier 1** | SLO: 99.9% availability, p95 read < 300 ms, cause-list generation 100% reliable, DLQ = 0  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Judiciary/Court Domain Owner | **Escalation:** SRE → CTO  
> **Slack:** `#incident-court` | **PagerDuty:** `court-critical`  

---

## Purpose

Full court/tribunal case management — case registration (CNR-based), case lifecycle transitions (strict state machine), hearing scheduling/adjournment/outcome, order/judgment recording (legally immutable), filing submission with scrutiny/defect management, daily cause-list generation, notice issuance/service-of-process, compliance/direction monitoring, appeal/revision/review lifecycle, evidence management (SHA-256 tamper-evidence), party management (PII encrypted), certified copy issuance, and public case lookup. Owns `civitas_court` on port 3034. 19 modules mirroring the Indian judiciary's operational workflow. If court is down, daily cause-lists cannot generate (courts cannot function), hearings go unrecorded, filings are blocked, and statutory deadlines are missed.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_court`) | `curl -s http://court:3034/ready \| jq .checks.db` | Total outage — all court operations halt |
| Redis | `curl -s http://court:3034/ready \| jq .checks.cache` | Degraded reads (case status, cause-list, hearing schedule) |
| SQS/RabbitMQ | `curl -s http://court:3034/ready \| jq .checks.queue` | Commands stop, events not emitted |
| Notification-service | `curl -s http://notification:3006/health` | Hearing reminders, notice service confirmations not sent |
| Analytics-service (consumer) | `curl -s http://analytics:3031/health` | Court facts not flowing to dashboards (non-blocking) |
| e-Courts (NJDG) | `curl -s http://court:3034/ops/circuit-breakers \| jq .ecourts` | Case status sync offline (graceful degrade) |

**Events produced:** `court.case.registered`, `court.case.status_changed`, `court.hearing.scheduled`, `court.hearing.adjourned`, `court.order.recorded`, `court.causelist.generated`, `court.filing.submitted`, `court.notice.issued`

**Events consumed:** None (court-service has no CONSUMED_EVENTS — it is a source service)

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Court Overview | `https://grafana.internal/d/court-overview` | Cases by status, daily filings, p95 latency |
| DLQ Monitor | `https://grafana.internal/d/court-dlq` | DLQ depth by topic (hearing/causelist = critical) |
| Cause-List Status | `https://grafana.internal/d/court-causelist` | Generation status by court, daily/weekly trends |
| Hearing Calendar | `https://grafana.internal/d/court-hearings` | Upcoming hearings, adjournment rate, outcome recording lag |
| Compliance Monitor | `https://grafana.internal/d/court-compliance` | Overdue directions, appeal pipeline |

---

## Failure Modes

### FM-01: Cause-list generation failed (courts cannot operate)

| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **Time to act** | < 5 min (courts need list by 9 AM) |
| **Alert** | `court_causelist_generation_failed` OR `court_causelist_not_generated_by_0800` |
| **Impact** | Court cannot function for the day — no case scheduling, hearings cannot proceed |

**Triage:**

```
Cause-list generation failed
├── Did the scheduled job fire?
│   → curl -s http://court:3034/ops/heartbeat | jq '.scheduledJobs.causelistGeneration'
│   ├── Not running / stale > 24h → Scheduler dead
│   │   → docker restart civitasone-court-worker
│   │   → After restart: manually trigger for TODAY
│   │   → curl -X POST http://court:3034/ops/causelist/generate-now -d '{"forDate": "2026-07-26"}'
│   └── Running → Job fired but failed
│       → Check DLQ: curl -s http://court:3034/ops/dlq/peek?topic=court.causelist.generate&limit=5
│       ├── "CASE_PARCEL_CONFLICT" → Case linked to two hearings on same day
│       │   → Identify conflicting case: jq '.[0].payload.conflictCaseId'
│       │   → Resolve: adjourn one hearing to different date
│       │   → Then re-trigger generation
│       ├── "BENCH_NOT_ASSIGNED" → Court/date has no bench assignment
│       │   → Admin must assign bench before cause-list can generate
│       │   → This is a configuration issue
│       ├── "DB_ERROR" / "TIMEOUT" → Transient
│       │   → Check DB health, then re-trigger
│       └── Unknown → Escalate immediately (courts open at 10 AM)
├── Was it generated but for the wrong date?
│   → psql civitas_court -c "SELECT court_id, list_date, item_count, generated_at
│      FROM court.cause_lists WHERE generated_at > NOW() - INTERVAL '24 hours'
│      ORDER BY generated_at DESC;"
│   → If yesterday's date → Clock/timezone issue or scheduler fired early
└── Which courts are affected?
    → psql civitas_court -c "SELECT c.id, c.name FROM court.courts c
       WHERE c.id NOT IN (SELECT court_id FROM court.cause_lists WHERE list_date = CURRENT_DATE);"
    → Generate individually for each affected court
```

**Commands:**

```bash
# Check which courts have today's cause-list
psql civitas_court -c "
  SELECT c.id, c.name, cl.item_count, cl.generated_at
  FROM court.courts c
  LEFT JOIN court.cause_lists cl ON cl.court_id = c.id AND cl.list_date = CURRENT_DATE
  ORDER BY c.name;
"

# Check DLQ for generation failures
curl -s http://court:3034/ops/dlq/peek?topic=court.causelist.generate&limit=5 | jq .

# Manually trigger cause-list generation for today
curl -X POST http://court:3034/ops/causelist/generate-now \
  -H "Content-Type: application/json" \
  -d '{"forDate": "'"$(date +%Y-%m-%d)"'"}'

# Generate for a specific court
curl -X POST http://court:3034/ops/causelist/generate-now \
  -H "Content-Type: application/json" \
  -d '{"forDate": "'"$(date +%Y-%m-%d)"'", "courtId": "{courtId}"}'

# Check for case-parcel conflicts (cases with multiple hearings on same day)
psql civitas_court -c "
  SELECT h.case_id, COUNT(*) as hearing_count
  FROM court.hearings h
  WHERE h.scheduled_at::date = CURRENT_DATE AND h.status = 'scheduled'
  GROUP BY h.case_id HAVING COUNT(*) > 1;
"

# Check worker health
curl -s http://court:3034/ops/heartbeat | jq .
docker logs civitasone-court-worker --tail=50 --since=30m 2>&1 | grep -E "causelist|ERROR"
```

**Verification after fix:**

```bash
# All courts have today's cause-list
psql civitas_court -c "
  SELECT c.name, cl.item_count FROM court.courts c
  JOIN court.cause_lists cl ON cl.court_id = c.id
  WHERE cl.list_date = CURRENT_DATE
  ORDER BY c.name;
"

# Cause-list event published
curl -s http://court:3034/ops/metrics | grep court_causelist_generated_total

# No remaining DLQ entries
curl -s http://court:3034/ops/dlq/peek?topic=court.causelist.generate | jq 'length == 0'
```

**Communication template:**

> 🔴 **[P0] Court — Cause-list generation FAILED**  
> Affected courts: {list}. Courts need list by 9 AM for daily operations.  
> Root cause: {case-parcel conflict | bench not assigned | DB timeout | scheduler dead}.  
> Manual generation triggered. ETA for resolution: {5 min for re-trigger | 15 min for conflict}.  
> ESCALATION: Court domain owner + registrar notified.

---

### FM-02: Hearing outcome not recorded (stale case status)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `court_hearing_outcome_not_recorded` (hearing > 24h old, no outcome) |
| **Impact** | Case status stale, next hearing not scheduled, parties not notified |

**Triage:**

```
Hearing outcome not recorded
├── Is this a system issue or data-entry gap?
│   → psql civitas_court -c "SELECT h.id, h.case_id, h.scheduled_at, h.outcome
│      FROM court.hearings h WHERE h.scheduled_at < NOW() - INTERVAL '24 hours'
│      AND h.outcome IS NULL AND h.status = 'scheduled'
│      ORDER BY h.scheduled_at DESC LIMIT 20;"
│   ├── Many hearings across courts → Likely system issue
│   │   → Check if court.hearing.record_outcome consumer is running
│   │   → curl -s http://court:3034/ops/consumer-status | jq '.consumers["court.hearing.record_outcome"]'
│   │   → Check DLQ: curl -s http://court:3034/ops/dlq/peek?topic=court.hearing.record_outcome
│   └── Specific court/bench → Data entry gap (court staff haven't recorded)
│       → Not a system issue. Notify court admin.
├── Is the e-Courts sync providing outcomes?
│   → curl -s http://court:3034/ops/circuit-breakers | jq '.ecourts'
│   → e-Courts sync can auto-update hearing outcomes if configured
└── Was there an adjournment that wasn't recorded?
    → If hearing was adjourned but not recorded, it appears as "no outcome"
    → Check court.hearing.adjourn DLQ
```

**Commands:**

```bash
# Find hearings without outcome
psql civitas_court -c "
  SELECT h.id, h.case_id, c.name as court_name, h.scheduled_at,
         NOW() - h.scheduled_at as overdue
  FROM court.hearings h
  JOIN court.courts c ON c.id = h.court_id
  WHERE h.scheduled_at < NOW() - INTERVAL '24 hours'
  AND h.outcome IS NULL AND h.status = 'scheduled'
  ORDER BY h.scheduled_at DESC LIMIT 20;
"

# Check outcome recording consumer
curl -s http://court:3034/ops/consumer-status | jq '.consumers["court.hearing.record_outcome"]'

# Check adjournment DLQ
curl -s http://court:3034/ops/dlq/peek?topic=court.hearing.adjourn&limit=5 | jq .
curl -s http://court:3034/ops/dlq/peek?topic=court.hearing.record_outcome&limit=5 | jq .

# Check e-Courts sync status
curl -s http://court:3034/ops/circuit-breakers | jq '.ecourts'
```

**Verification after fix:**

```bash
# Outcomes being recorded
psql civitas_court -c "
  SELECT COUNT(*) FROM court.hearings
  WHERE scheduled_at > NOW() - INTERVAL '48 hours'
  AND outcome IS NOT NULL;
"
```

**Communication template:**

> 🟡 **[P2] Court — Hearing outcomes not recorded for {N} hearings**  
> Hearings from {date} without outcome. Root cause: {consumer stalled | data entry gap | e-Courts sync down}.  
> Case status remains at last known state. No legal data loss.  
> ETR: {5 min for consumer fix | notification to court staff for data entry}.

---

### FM-03: Filing scrutiny/defect stuck

| Field | Value |
|-------|-------|
| **Severity** | P3 |
| **Time to act** | < 1 hour |
| **Alert** | `court_scrutiny_pending_age > 7d` |
| **Impact** | Filings not progressing — case registration delayed |

**Triage:**

```
Scrutiny stuck
├── Is it a system issue?
│   → curl -s http://court:3034/ops/dlq/peek?topic=court.scrutiny.resolve&limit=5 | jq .
│   ├── DLQ entries → Consumer failing on resolve command
│   │   → Check error: likely optimistic lock version mismatch
│   │   → Scrutiny was updated concurrently (e-Courts sync + manual)
│   │   → Redrive with latest version
│   └── No DLQ → Business process (registry staff haven't reviewed)
│       → Not a system issue
├── Is the defect resolution command being published?
│   → Check if "Resolve Defect" button publishes court.defect.resolve
│   → Verify route is responding: curl -s http://court:3034/v1/court/scrutiny/{id}
└── Is there a circular defect (defect referencing itself)?
    → Rare edge case. Check defect chain.
```

**Commands:**

```bash
# Find long-pending scrutiny items
psql civitas_court -c "
  SELECT s.id, s.filing_id, s.status, s.created_at,
         NOW() - s.created_at as pending_duration
  FROM court.scrutiny s
  WHERE s.status = 'pending'
  AND s.created_at < NOW() - INTERVAL '7 days'
  ORDER BY s.created_at LIMIT 10;
"

# Check DLQ for scrutiny/defect commands
curl -s http://court:3034/ops/dlq/peek?topic=court.scrutiny.resolve&limit=5 | jq .
curl -s http://court:3034/ops/dlq/peek?topic=court.defect.resolve&limit=5 | jq .

# Redrive (after verifying cause)
curl -X POST http://court:3034/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "court.scrutiny.resolve", "batchSize": 5}'
```

**Communication template:**

> 🔵 **[P3] Court — Filing scrutiny items pending > 7 days**  
> {N} filings awaiting registry scrutiny. Root cause: {staff backlog | consumer DLQ | version conflict}.  
> No court operations blocked (filings are pending, not rejected).  
> ETR: {immediate for DLQ fix | business process for staff backlog}.

---

### FM-04: Case status transition rejected (state machine violation)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `court_case_transition_rejected_total` increasing |
| **Impact** | Cases not advancing through lifecycle — disposals, hearings blocked |

**Triage:**

```
Case transition rejected
├── Check the rejection reason
│   → docker logs civitasone-court-worker --since=10m 2>&1 | grep "transition.*rejected"
│   ├── "INVALID_TRANSITION" → Attempted illegal state change
│   │   → Valid states: filed → hearing → reserved → disposed
│   │   → Cannot skip states. Check what transition was attempted.
│   │   → If from UI: frontend allowing invalid action buttons
│   │   → If from consumer: event ordering issue
│   ├── "VERSION_MISMATCH" → Optimistic lock conflict
│   │   → Case was updated between read and write
│   │   → Retry with latest version from DB
│   └── "CASE_NOT_FOUND" → Case ID invalid or wrong tenant
│       → Check tenant isolation
├── Is it from e-Courts sync attempting conflicting transitions?
│   → e-Courts sync may update status independently
│   → If sync and manual update collide → version mismatch
│   → Resolution: let the latest-timestamp version win
└── Is the update_status command in DLQ?
    → curl -s http://court:3034/ops/dlq/peek?topic=court.case.update_status | jq .
```

**Commands:**

```bash
# Check recent transition rejections
docker logs civitasone-court-worker --since=30m 2>&1 | grep -i "transition\|rejected\|invalid" | tail -20

# Check DLQ for status update failures
curl -s http://court:3034/ops/dlq/peek?topic=court.case.update_status&limit=5 | jq '.[0] | {caseId: .payload.caseId, from: .payload.from, to: .payload.to, error}'

# Check case's current state and version
psql civitas_court -c "
  SELECT id, status, version, updated_at
  FROM court.cases WHERE id = '{caseId}';
"

# Redrive with updated version (only for version mismatch)
curl -X POST http://court:3034/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "court.case.update_status", "batchSize": 5}'
```

**Verification after fix:**

```bash
# No more DLQ entries
curl -s http://court:3034/ops/dlq/peek?topic=court.case.update_status | jq 'length == 0'

# Case transitioned successfully
psql civitas_court -c "SELECT id, status, version FROM court.cases WHERE id = '{caseId}';"
```

**Communication template:**

> 🟡 **[P2] Court — Case status transitions rejected**  
> {N} transitions rejected in last hour. Root cause: {version mismatch | invalid state | e-Courts sync conflict}.  
> Cases remain in previous valid state. No data corruption.  
> ETR: {10 min for version-mismatch redrive | investigation for invalid transitions}.

---

### FM-05: Consumer stalled (court-worker)

| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **Time to act** | < 5 min |
| **Alert** | `court_worker_heartbeat_stale > 60s` |
| **Impact** | ALL court commands stop — cause-list, hearings, filings, orders, notices |

**Commands:**

```bash
# Check worker heartbeat
curl -s http://court:3034/ops/heartbeat | jq .

# View error logs
docker logs civitasone-court-worker --tail=100 --since=5m 2>&1 | grep -E "ERROR|FATAL|OOM"

# Restart worker
docker restart civitasone-court-worker

# Verify recovery
sleep 5 && curl -s http://court:3034/ops/heartbeat | jq '.ageSeconds < 10'

# CRITICAL: Check if today's cause-list needs regeneration
psql civitas_court -c "
  SELECT COUNT(*) as courts_without_list FROM court.courts c
  WHERE c.id NOT IN (SELECT court_id FROM court.cause_lists WHERE list_date = CURRENT_DATE);
"

# If courts missing cause-list, generate immediately
curl -X POST http://court:3034/ops/causelist/generate-now \
  -H "Content-Type: application/json" \
  -d '{"forDate": "'"$(date +%Y-%m-%d)"'"}'

# Check DLQ depth
curl -s http://court:3034/ops/dlq | jq '.topics[] | select(.depth > 0)'
```

**Communication template:**

> 🔴 **[P0] Court worker stalled — ALL court operations halted**  
> Cause-list generation, hearing records, filing processing all stopped.  
> Root cause: {OOM | poison message | DB connection exhaustion}.  
> Worker restarted. Cause-list regeneration triggered if missing.  
> ETR: {5 min for restart + catch-up}.

---

## Rollback

```bash
# Docker
docker pull civitasone/court-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d court-service court-worker

# K8s
kubectl set image deployment/court-service \
  court=civitasone/court-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/court-worker \
  worker=civitasone/court-service:$PREVIOUS_TAG -n civitasone

# Verify health
curl -s http://court:3034/health | jq .

# Verify cause-list generation
curl -s http://court:3034/ops/heartbeat | jq '.scheduledJobs.causelistGeneration'

# Verify consumers
curl -s http://court:3034/ops/consumer-status | jq '.consumers | keys'
```

**CRITICAL:** Case records, orders, and judgments are legally immutable — never alter after recording. Cause-list generation is idempotent (regenerating for the same date replaces the previous list). Filing sequence numbers per court/year must never have duplicates.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh court --target-time="2026-07-26T02:00:00Z"

# 2. IMMEDIATELY: Regenerate today's cause-list
curl -X POST http://court:3034/ops/causelist/generate-now \
  -H "Content-Type: application/json" \
  -d '{"forDate": "'"$(date +%Y-%m-%d)"'"}'

# 3. Verify hearing outcomes for hearings during downtime
psql civitas_court -c "
  SELECT h.id, h.case_id, h.scheduled_at, h.outcome
  FROM court.hearings h
  WHERE h.scheduled_at BETWEEN '2026-07-26T01:45:00Z' AND NOW()
  AND h.outcome IS NULL;
"

# 4. Confirm filing sequence numbers (no duplicates)
psql civitas_court -c "
  SELECT court_id, filing_year, filing_number, COUNT(*)
  FROM court.filings
  GROUP BY court_id, filing_year, filing_number
  HAVING COUNT(*) > 1;
"

# 5. Verify evidence hashes intact (SHA-256 tamper-evidence)
psql civitas_court -c "
  SELECT id, document_hash, verified FROM court.evidence
  WHERE submitted_at > '2026-07-26T01:45:00Z'
  ORDER BY submitted_at;
"

# 6. Replay outbox
curl -X POST http://court:3034/ops/outbox-relay/replay-pending

# 7. Check compliance directions overdue during downtime
psql civitas_court -c "
  SELECT id, case_id, due_date, status FROM court.compliance_directions
  WHERE due_date BETWEEN '2026-07-26T01:45:00Z' AND NOW()
  AND status = 'pending';
"
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Court service restored**  
> DB restored to {timestamp}. Today's cause-list regenerated ({N} courts).  
> Hearings during outage: {M} need manual outcome recording.  
> Filing sequences verified — no duplicates. Evidence hashes intact.  
> Compliance directions reviewed. Outbox replayed.
