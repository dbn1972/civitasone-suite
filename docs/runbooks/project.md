# Runbook: project-service

> **Tier 2** | SLO: 99.5% availability, p95 read < 400 ms, fund-release integrity 100%, DLQ = 0  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Project/Scheme Domain Owner | **Escalation:** Finance Owner → SRE → CTO  
> **Slack:** `#incident-project` | **PagerDuty:** `project-critical`  

---

## Purpose

Government scheme/project management — project creation with scheme linkage, task management, milestone tracking, fund-release lifecycle (allocation ceiling enforcement), DPR (Detailed Project Report) submission, utilisation certificate (UC) submission with expenditure validation, geo-tagging of project sites (photo evidence), physical/financial progress recording, delay forecasting (ml-service integration), and board-intake for meeting-service decisions. All amounts in BigInt paise. Owns `civitas_project` on port 3014. If project-service is down, fund releases halt (government scheme money flow stopped), milestone completion events don't reach grant-service, and UC submissions block.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_project`) | `curl -s http://project:3014/ready \| jq .checks.db` | Total outage — all project operations halt |
| Redis | `curl -s http://project:3014/ready \| jq .checks.cache` | Degraded reads (project status, milestone progress, fund balances) |
| SQS/RabbitMQ | `curl -s http://project:3014/ready \| jq .checks.queue` | Commands stop, events not emitted |
| S3/MinIO (geo-tag photos) | `curl -s http://project:3014/ops/circuit-breakers \| jq .storage` | Photo uploads fail (non-blocking for core operations) |
| Grant-service (milestone→disbursement) | `curl -s http://grant:3019/health` | Milestone completion doesn't trigger next grant installment |
| Finance-service (fund-release GL) | `curl -s http://finance:3007/health` | Fund release GL posting delayed |
| ml-service (delay forecast) | `curl -s http://ml:3032/health` | Delay risk scoring unavailable (graceful degrade) |
| Meeting-service (board decisions) | `curl -s http://meeting:3033/health` | Board decisions not creating project triage items |

**Cross-service consumed:** `ml.prediction.task_high_risk` (delay risk), `meeting.decision.project` (board decisions)

**Cross-service produced:** `project.milestone.completed` (→ grant-service), `project.fund_release.approved`/`disbursed` (→ finance)

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Project Overview | `https://grafana.internal/d/project-overview` | Schemes by status, fund utilization, p95 latency |
| DLQ Monitor | `https://grafana.internal/d/project-dlq` | DLQ depth (fund-release topics = CRITICAL) |
| Fund Utilization | `https://grafana.internal/d/project-funds` | Scheme allocation vs utilized, release pipeline |
| Milestone Tracker | `https://grafana.internal/d/project-milestones` | Completion rate, delay-risk distribution |
| Geo-Tag Coverage | `https://grafana.internal/d/project-geo` | Site inspection coverage, photo evidence gaps |

---

## Failure Modes

### FM-01: Fund release blocked (allocation exceeded)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 15 min |
| **Alert** | `project_fund_release_allocation_exceeded` |
| **Impact** | Government scheme money flow stopped — beneficiaries/contractors not paid |

**Triage:**

```
Fund release blocked — allocation exceeded
├── Is this correct domain behavior? (most likely YES)
│   → The release amount exceeds the scheme component's budget allocation
│   → This is a SAFETY GUARD — not a bug
│   → Check: was the allocation set correctly?
│   → psql civitas_project -c "SELECT sc.id, sc.name, sc.allocation_minor,
│      sc.utilized_minor, sc.allocation_minor - sc.utilized_minor as remaining_minor
│      FROM project.scheme_components sc WHERE sc.id = '{componentId}';"
│   ├── remaining < release amount → Allocation genuinely exceeded
│   │   → Options:
│   │   │ 1. Increase allocation (if scheme received additional budget)
│   │   │    → Requires scheme admin approval → eOffice file
│   │   │ 2. Reduce release amount to fit remaining
│   │   │ 3. Wait for next financial year allocation
│   │   → NEVER bypass the ceiling check
│   └── remaining >= release amount → BUG in utilization counter
│       → Verify utilized_minor matches actual disbursements
│       → psql: SELECT SUM(amount_minor) FROM project.fund_releases WHERE component_id = '{id}' AND status = 'completed';
│       → If mismatch → Counter drift. Recalculate.
├── Was there a concurrent release that consumed the remaining allocation?
│   → Check recent releases on the same component
│   → psql: SELECT id, amount_minor, status, created_at FROM project.fund_releases
│      WHERE component_id = '{id}' ORDER BY created_at DESC LIMIT 10;
└── Is this a DLQ entry or a route-level rejection?
    → Route returns 422 (business rule violation) immediately
    → If in DLQ: consumer processing failed after initial validation passed (race condition)
```

**Commands:**

```bash
# Check scheme component budget status
psql civitas_project -c "
  SELECT sc.id, sc.name, s.name as scheme_name,
         sc.allocation_minor / 100.0 as allocation_rupees,
         sc.utilized_minor / 100.0 as utilized_rupees,
         (sc.allocation_minor - sc.utilized_minor) / 100.0 as remaining_rupees
  FROM project.scheme_components sc
  JOIN project.schemes s ON s.id = sc.scheme_id
  WHERE sc.id = '{componentId}';
"

# Check recent fund releases on this component
psql civitas_project -c "
  SELECT id, amount_minor / 100.0 as amount_rupees, status, created_at
  FROM project.fund_releases
  WHERE component_id = '{componentId}'
  ORDER BY created_at DESC LIMIT 10;
"

# Verify utilization counter matches actual (detect drift)
psql civitas_project -c "
  SELECT sc.id, sc.utilized_minor,
         COALESCE(SUM(fr.amount_minor), 0) as actual_utilized
  FROM project.scheme_components sc
  LEFT JOIN project.fund_releases fr ON fr.component_id = sc.id AND fr.status = 'completed'
  WHERE sc.id = '{componentId}'
  GROUP BY sc.id, sc.utilized_minor;
"

# Fix utilization counter drift (if detected)
psql civitas_project -c "
  UPDATE project.scheme_components
  SET utilized_minor = (SELECT COALESCE(SUM(amount_minor), 0) FROM project.fund_releases WHERE component_id = '{componentId}' AND status = 'completed')
  WHERE id = '{componentId}';
"

# Check DLQ for fund release commands
curl -s http://project:3014/ops/dlq/peek?topic=project.fund_release.create&limit=5 | jq .
curl -s http://project:3014/ops/dlq/peek?topic=project.fund_release.disburse&limit=5 | jq .
```

**Verification after fix:**

```bash
# Counter reconciled
psql civitas_project -c "
  SELECT id, allocation_minor, utilized_minor,
         allocation_minor - utilized_minor as remaining
  FROM project.scheme_components WHERE id = '{componentId}';
"

# Fund release can proceed (if allocation increased or counter fixed)
curl -s http://project:3014/ops/metrics | grep project_fund_release_approved_total
```

**Communication template:**

> 🟠 **[P1] Project — Fund release blocked (allocation exceeded)**  
> Scheme: {schemeName}, Component: {componentName}.  
> Requested: ₹{amount}. Remaining allocation: ₹{remaining}.  
> This is {correct safety behavior | counter drift bug}.  
> Action: {scheme admin must increase allocation | counter reconciled — retrying}.  
> ETR: {immediate if counter fix | depends on approval for allocation increase}.

---

### FM-02: Milestone completion not triggering grant disbursement

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 15 min |
| **Alert** | `project_milestone_event_delivery_failed` OR manual report from grant team |
| **Impact** | Grant installment blocked — beneficiaries waiting for next disbursement |

**Triage:**

```
Milestone→grant event not flowing
├── Was the milestone completion event published?
│   → psql civitas_project -c "SELECT id, topic, relayed_at, error FROM project.outbox
│      WHERE topic = 'project.milestone.completed' AND created_at > NOW() - INTERVAL '2 hours'
│      ORDER BY created_at DESC LIMIT 5;"
│   ├── relayed_at IS NULL → Outbox relay stuck
│   │   → curl -s http://project:3014/ops/outbox-relay | jq '.pendingCount'
│   │   → Restart: curl -X POST http://project:3014/ops/outbox-relay/restart
│   ├── relayed_at set → Event was published
│   │   → Check grant-service side: did they receive it?
│   │   → curl -s http://grant:3019/ops/consumer-status | jq '.consumers["project.milestone.completed"]'
│   │   → Check grant-service DLQ for this event
│   └── error field set → Outbox relay failed on this message
│       → Check error. Likely: serialization or queue connectivity issue.
├── Was the milestone actually marked complete in DB?
│   → psql civitas_project -c "SELECT id, status, completed_at FROM project.milestones WHERE id = '{milestoneId}';"
│   ├── status != 'completed' → Milestone completion command not processed
│   │   → Check DLQ: curl -s http://project:3014/ops/dlq/peek?topic=project.milestone.complete
│   └── status = 'completed' → Event should have been emitted
│       → Check outbox for this specific milestone
└── Is grant-service healthy?
    → curl -s http://grant:3019/health | jq .
    → If unhealthy: event will be delivered when grant recovers (SQS persistence)
```

**Commands:**

```bash
# Check milestone status
psql civitas_project -c "
  SELECT id, project_id, name, status, completed_at
  FROM project.milestones
  WHERE id = '{milestoneId}';
"

# Check outbox for milestone event
psql civitas_project -c "
  SELECT id, topic, payload, created_at, relayed_at, error
  FROM project.outbox
  WHERE topic = 'project.milestone.completed'
  ORDER BY created_at DESC LIMIT 5;
"

# Check outbox relay health
curl -s http://project:3014/ops/outbox-relay | jq .

# Restart outbox relay
curl -X POST http://project:3014/ops/outbox-relay/restart

# Check grant-service received the event
curl -s http://grant:3019/ops/consumer-status | jq '.consumers["project.milestone.completed"]'

# Check if grant-service has the milestone event in DLQ
curl -s http://grant:3019/ops/dlq/peek?topic=project.milestone.completed&limit=5 | jq .

# Replay pending outbox events
curl -X POST http://project:3014/ops/outbox-relay/replay-pending
```

**Verification after fix:**

```bash
# Outbox event relayed
psql civitas_project -c "
  SELECT id, relayed_at FROM project.outbox
  WHERE topic = 'project.milestone.completed'
  ORDER BY created_at DESC LIMIT 1;
"

# Grant-service processing (check if disbursement was unblocked)
curl -s "http://grant:3019/v1/grants/applications/{appId}/installments" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {installment_no, status}'
```

**Communication template:**

> 🟠 **[P1] Project — Milestone completion event not reaching grant-service**  
> Milestone {milestoneId} completed but grant disbursement not triggered.  
> Root cause: {outbox relay stuck | grant consumer dead | event serialization error}.  
> Grant installment blocked for application {appId}. No data loss.  
> ETR: {5 min for outbox restart | coordinate with grant team if their side}.

---

### FM-03: UC submission rejected (expenditure exceeds release)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 1 hour |
| **Alert** | `project_uc_expenditure_exceeded_total` increasing |
| **Impact** | UC cannot be submitted — scheme compliance at risk, next installment blocked |

**Triage:**

```
UC expenditure exceeds release
├── Is this a data-entry error? (MOST COMMON)
│   → UC reported expenditure > total funds released to this project
│   → This is correct validation — the UC must be corrected
│   → Check: what was released vs what UC claims spent
│   → psql civitas_project -c "SELECT
│        (SELECT SUM(amount_minor) FROM project.fund_releases WHERE project_id = '{projectId}' AND status = 'completed') as total_released,
│        (SELECT expenditure_minor FROM project.utilisation_certificates WHERE id = '{ucId}') as uc_claimed;"
│   ├── UC claimed > released → Data entry error. UC must be reduced.
│   └── UC claimed <= released → BUG in validation logic or stale cache
│       → Flush cache: redis-cli -p 6381 DEL "project:{tenant}:fund_release:{projectId}"
│       → Retry submission
├── Was a recent fund release not reflected in the total?
│   → Check if a fund release is stuck in 'approved' but not 'completed'
│   → psql: SELECT id, status, amount_minor FROM project.fund_releases WHERE project_id = '{projectId}' AND status = 'approved';
│   → If stuck: fund release event didn't propagate to finance. Check FM-01.
└── Is the UC validation comparing against the correct release total?
    → The validation should sum ALL completed releases for the project
    → If it's checking per-installment: logic bug
```

**Commands:**

```bash
# Check project fund release vs UC expenditure
psql civitas_project -c "
  SELECT p.id, p.name,
         COALESCE(SUM(fr.amount_minor), 0) / 100.0 as total_released_rupees
  FROM project.projects p
  LEFT JOIN project.fund_releases fr ON fr.project_id = p.id AND fr.status = 'completed'
  WHERE p.id = '{projectId}'
  GROUP BY p.id, p.name;
"

# Check the UC that was rejected
psql civitas_project -c "
  SELECT id, project_id, expenditure_minor / 100.0 as claimed_rupees,
         status, rejection_reason, created_at
  FROM project.utilisation_certificates
  WHERE project_id = '{projectId}'
  ORDER BY created_at DESC LIMIT 5;
"

# Check for stuck fund releases
psql civitas_project -c "
  SELECT id, amount_minor / 100.0 as amount_rupees, status, created_at
  FROM project.fund_releases
  WHERE project_id = '{projectId}' AND status != 'completed'
  ORDER BY created_at;
"

# Flush fund release cache (if stale)
redis-cli -p 6381 DEL "project:{tenantId}:fund_release:{projectId}"
```

**Verification after fix:**

```bash
# UC submission succeeds
psql civitas_project -c "
  SELECT id, status FROM project.utilisation_certificates
  WHERE project_id = '{projectId}' ORDER BY created_at DESC LIMIT 1;
"
```

**Communication template:**

> 🟡 **[P2] Project — UC submission rejected (expenditure > released)**  
> Project {projectName}: UC claims ₹{claimed}, total released: ₹{released}.  
> Root cause: {data entry error | fund release stuck | cache stale}.  
> Action: {UC must be corrected by submitter | cache flushed — retry | fund release unblocked}.  
> ETR: {immediate for cache fix | business process for data correction}.

---

### FM-04: Geo-tag upload failing (S3/MinIO)

| Field | Value |
|-------|-------|
| **Severity** | P3 |
| **Time to act** | < 2 hours |
| **Alert** | `project_geotag_upload_failure_rate > 20%` |
| **Impact** | Site inspection photos not stored — audit evidence gap (not blocking core operations) |

**Triage:**

```
Geo-tag upload failing
├── Check storage circuit breaker
│   → curl -s http://project:3014/ops/circuit-breakers | jq '.storage'
│   ├── state: "open" → S3/MinIO unreachable
│   │   → Check S3_ENDPOINT connectivity
│   │   → Check bucket permissions
│   │   → If MinIO: check MinIO container health
│   └── state: "closed" → Storage reachable but uploads failing
│       → Check specific error in logs
│       → docker logs civitasone-project --since=10m | grep "geotag\|upload\|S3"
│       ├── "ACCESS_DENIED" → IAM/bucket policy issue
│       ├── "BUCKET_NOT_FOUND" → Bucket deleted or wrong config
│       └── "PAYLOAD_TOO_LARGE" → Photo exceeds size limit
├── Are GPS coordinates being validated?
│   → Invalid coordinates (0,0 or out of India) may be rejected
│   → Check: is lat/lng within valid range?
└── Is this blocking project progress recording?
    → Geo-tags are evidence/audit artifacts
    → Core project operations (fund release, milestones) NOT blocked
```

**Commands:**

```bash
# Check storage circuit breaker
curl -s http://project:3014/ops/circuit-breakers | jq '.storage'

# Check recent upload failures
docker logs civitasone-project --since=30m 2>&1 | grep -i "upload\|geotag\|S3\|storage" | grep -i "error\|fail" | tail -10

# Check S3/MinIO health
curl -s http://project:3014/ops/storage-health | jq .

# Check storage credentials
docker exec civitasone-project env | grep -E "S3_|MINIO_" | sed 's/=.*/=***/'

# Check DLQ for geo-tag commands
curl -s http://project:3014/ops/dlq/peek?topic=project.geo.tag&limit=5 | jq .
curl -s http://project:3014/ops/dlq/peek?topic=project.photo.upload&limit=5 | jq .

# Force circuit breaker half-open (if storage confirmed back)
curl -X POST http://project:3014/ops/circuit-breakers/storage/half-open
```

**Verification after fix:**

```bash
# Uploads succeeding
curl -s http://project:3014/ops/metrics | grep project_geotag_upload_success

# Circuit breaker closed
curl -s http://project:3014/ops/circuit-breakers | jq '.storage.state == "closed"'
```

**Communication template:**

> 🔵 **[P3] Project — Geo-tag photo uploads failing**  
> Upload failure rate: {N}%. Root cause: {S3 unreachable | permissions | bucket missing}.  
> Core operations (fund release, milestones) unaffected.  
> Site inspection photos queued — will upload when storage recovers.  
> ETR: {depends on storage fix}.

---

### FM-05: Consumer stalled (project-worker)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `project_worker_heartbeat_stale > 60s` |
| **Impact** | Fund releases, milestone completions, UC validations, progress recording all stop |

**Commands:**

```bash
# Check worker heartbeat
curl -s http://project:3014/ops/heartbeat | jq .

# View error logs
docker logs civitasone-project-worker --tail=100 --since=5m 2>&1 | grep -E "ERROR|FATAL|OOM"

# Restart worker
docker restart civitasone-project-worker

# Verify recovery
sleep 5 && curl -s http://project:3014/ops/heartbeat | jq '.ageSeconds < 10'

# Check DLQ for poison message
curl -s http://project:3014/ops/dlq | jq '.topics[] | select(.depth > 0)'

# Verify fund-release commands are flowing again
curl -s http://project:3014/ops/consumer-status | jq '.consumers["project.fund_release.create"]'
```

**Communication template:**

> 🟠 **[P1] Project worker stalled — fund releases and milestones halted**  
> ALL project commands stopped. Government scheme money flow affected.  
> Root cause: {OOM | poison message | DB connection exhaustion}.  
> Worker restarted. Queued commands will process.  
> ETR: {5 min for restart + catch-up}.

---

## Rollback

```bash
# Docker
docker pull civitasone/project-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d project-service project-worker

# K8s
kubectl set image deployment/project-service \
  project=civitasone/project-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/project-worker \
  worker=civitasone/project-service:$PREVIOUS_TAG -n civitasone

# Verify health
curl -s http://project:3014/health | jq .

# Verify consumers reconnected
curl -s http://project:3014/ops/consumer-status | jq '.consumers | keys'

# Verify fund-release integrity
psql civitas_project -c "
  SELECT sc.id, sc.utilized_minor,
         COALESCE(SUM(fr.amount_minor), 0) as actual
  FROM project.scheme_components sc
  LEFT JOIN project.fund_releases fr ON fr.component_id = sc.id AND fr.status = 'completed'
  GROUP BY sc.id, sc.utilized_minor
  HAVING sc.utilized_minor != COALESCE(SUM(fr.amount_minor), 0);
"
```

**CRITICAL:** Fund-release records are append-only (never delete a disbursement). Scheme allocations can be increased but not decreased below utilized amount. Milestone completion events to grant-service are idempotent.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh project --target-time="2026-07-26T02:00:00Z"

# 2. Reconcile fund-release totals (utilization counters)
psql civitas_project -c "
  UPDATE project.scheme_components sc
  SET utilized_minor = COALESCE((
    SELECT SUM(amount_minor) FROM project.fund_releases
    WHERE component_id = sc.id AND status = 'completed'
  ), 0)
  WHERE sc.utilized_minor != COALESCE((
    SELECT SUM(amount_minor) FROM project.fund_releases
    WHERE component_id = sc.id AND status = 'completed'
  ), 0);
"

# 3. Verify milestone-to-grant linkage
psql civitas_project -c "
  SELECT m.id, m.project_id, m.status, m.completed_at
  FROM project.milestones m
  WHERE m.completed_at > '2026-07-26T01:45:00Z';
"

# 4. Replay outbox (milestone events to grant-service)
curl -X POST http://project:3014/ops/outbox-relay/replay-pending

# 5. Cross-reference with finance-service GL entries
psql civitas_project -c "
  SELECT fr.id, fr.amount_minor, fr.status FROM project.fund_releases fr
  WHERE fr.created_at > '2026-07-26T01:45:00Z' AND fr.status = 'disbursed';
"

# 6. Verify scheme utilization percentages
psql civitas_project -c "
  SELECT s.name, sc.name as component,
         sc.utilized_minor * 100.0 / NULLIF(sc.allocation_minor, 0) as utilization_pct
  FROM project.schemes s
  JOIN project.scheme_components sc ON sc.scheme_id = s.id
  ORDER BY utilization_pct DESC LIMIT 10;
"

# 7. Check delay risk scores (ml-service will re-score on next event)
psql civitas_project -c "
  SELECT id, name, delay_risk_score, risk_updated_at
  FROM project.tasks
  WHERE delay_risk_score > 0.8
  ORDER BY delay_risk_score DESC LIMIT 10;
"
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Project service restored**  
> DB restored to {timestamp}. Fund-release counters reconciled.  
> Milestone events replayed — grant-service linkage intact.  
> Scheme utilization verified. {N} fund releases during gap re-queued.  
> No duplicate disbursements (idempotency guards active).
