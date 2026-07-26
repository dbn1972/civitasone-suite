# Runbook: helpdesk-service

> **Tier 3** | SLO: 99.5% availability, p95 read < 300 ms, SLA breach rate < 5%, DLQ = 0  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** IT/Support Domain Owner | **Escalation:** SRE → CTO  
> **Slack:** `#incident-helpdesk` | **PagerDuty:** `helpdesk-standard`  

---

## Purpose

Internal IT/support helpdesk — ticket lifecycle (create/assign/transition/escalate), SLA engine with breach detection and auto-escalation, service catalogue (self-service request fulfillment with multi-stage workflows), automation rules, CMDB (configuration management database), and ml-breach-risk integration for proactive SLA management. Owns `civitas_helpdesk` on port 3027. If helpdesk is down, support tickets cannot be created/escalated, SLA timers stop (breach detection halts), service requests freeze, and auto-ticket creation from telephony/CRM/citizen fails.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_helpdesk`) | `curl -s http://helpdesk:3027/ready \| jq .checks.db` | Total outage — all helpdesk operations halt |
| Redis | `curl -s http://helpdesk:3027/ready \| jq .checks.cache` | Degraded reads (ticket lists, SLA timers, catalogue) |
| SQS/RabbitMQ | `curl -s http://helpdesk:3027/ready \| jq .checks.queue` | Commands stop, SLA events not emitted |
| Telephony-service | `curl -s http://telephony:3026/health` | Missed-call auto-ticket creation stops |
| CRM-service | `curl -s http://crm:3024/health` | CRM case → helpdesk ticket linking broken |
| Citizen-service | `curl -s http://citizen:3020/health` | Citizen requests don't create dept tickets |
| ml-service (breach risk) | `curl -s http://ml:3032/health` | Proactive SLA intervention stops (graceful degrade) |
| Workflow-service (service requests) | `curl -s http://workflow:3029/health` | Multi-stage request approvals stuck |
| Notification-service | `curl -s http://notification:3006/health` | Agent alerts not sent |

**Cross-service consumed:** `telephony.call.missed`, `crm.case.opened`, `ml.prediction.breach_risk_high`, `citizen.request.created`

**Cross-service produced:** `helpdesk.ticket.created`, `helpdesk.ticket.updated`, `helpdesk.ticket.escalated`, `helpdesk.request.fulfilled`

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Helpdesk Overview | `https://grafana.internal/d/helpdesk-overview` | Ticket volume, SLA compliance, agent utilization |
| DLQ Monitor | `https://grafana.internal/d/helpdesk-dlq` | DLQ depth by topic |
| SLA Engine | `https://grafana.internal/d/helpdesk-sla` | Breach rate, time-to-breach, escalation funnel |
| Service Requests | `https://grafana.internal/d/helpdesk-requests` | Request pipeline, fulfilment rate, stage bottlenecks |
| Inbound Integration | `https://grafana.internal/d/helpdesk-inbound` | Auto-ticket creation rate by source (telephony/CRM/citizen) |

---

## Failure Modes

### FM-01: SLA engine not computing (breach detection halted)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `helpdesk_sla_sweep_stale > 300s` OR `helpdesk_sla_engine_error_rate > 0` |
| **Impact** | Tickets won't auto-escalate on SLA breach — support commitments violated silently |

**Triage:**

```
SLA engine not computing
├── Is the SLA sweep scheduler running?
│   → curl -s http://helpdesk:3027/ops/heartbeat | jq '.scheduledJobs.slaSweep'
│   ├── Not running or stale > 5 min → Scheduler dead
│   │   → Restart worker: docker restart civitasone-helpdesk-worker
│   │   → After restart: manually trigger sweep
│   │   → curl -X POST http://helpdesk:3027/ops/sla-sweep-now
│   └── Running → Sweep running but failing
│       → Check logs: docker logs civitasone-helpdesk-worker --since=5m | grep "sla"
│       ├── "SLA_POLICY_NOT_FOUND" → Ticket has no matching SLA policy
│       │   → Likely: new ticket priority/category without SLA config
│       │   → Fix: add SLA policy for the missing priority
│       ├── "DB_ERROR" → Connection issue during sweep
│       │   → Check DB health: curl -s http://helpdesk:3027/ready | jq .checks.db
│       └── "TIMER_OVERFLOW" → SLA timer calculation error
│           → Check for tickets with created_at in the future (clock skew)
├── Are tickets being escalated at all?
│   → psql civitas_helpdesk -c "SELECT COUNT(*) FROM helpdesk.tickets
│      WHERE escalated_at > NOW() - INTERVAL '24 hours';"
│   ├── Count = 0 → Either no breaches (good) or escalation broken
│   │   → Force check: are there tickets past SLA?
│   │   → psql: SELECT id, created_at, sla_deadline FROM helpdesk.tickets
│   │      WHERE status NOT IN ('resolved', 'closed') AND sla_deadline < NOW();
│   │   → If such tickets exist → SLA engine is definitely broken
│   └── Count > 0 → Escalation working for some, check specific failures
└── Is the breach-risk ml prediction consumer alive?
    → curl -s http://helpdesk:3027/ops/consumer-status | jq '.consumers["ml.prediction.breach_risk_high"]'
    → If dead: ml prediction is optional (graceful degrade). Fix SLA sweep first.
```

**Commands:**

```bash
# Check SLA sweep status
curl -s http://helpdesk:3027/ops/heartbeat | jq '.scheduledJobs.slaSweep'

# Find tickets past SLA without escalation
psql civitas_helpdesk -c "
  SELECT id, priority, status, created_at, sla_deadline,
         NOW() - sla_deadline as overdue_by
  FROM helpdesk.tickets
  WHERE status NOT IN ('resolved', 'closed')
  AND sla_deadline < NOW()
  AND escalated_at IS NULL
  ORDER BY sla_deadline LIMIT 20;
"

# Force SLA sweep
curl -X POST http://helpdesk:3027/ops/sla-sweep-now

# Check SLA policies configuration
psql civitas_helpdesk -c "
  SELECT priority, response_time_minutes, resolution_time_minutes
  FROM helpdesk.sla_policies
  WHERE active = true
  ORDER BY priority;
"

# Check worker health
docker logs civitasone-helpdesk-worker --tail=50 --since=5m 2>&1 | grep -iE "sla|sweep|error"

# Restart worker
docker restart civitasone-helpdesk-worker
```

**Verification after fix:**

```bash
# SLA sweep running
curl -s http://helpdesk:3027/ops/heartbeat | jq '.scheduledJobs.slaSweep.lastRunAt'

# Overdue tickets now escalated
psql civitas_helpdesk -c "
  SELECT COUNT(*) FROM helpdesk.tickets
  WHERE sla_deadline < NOW() AND status NOT IN ('resolved', 'closed')
  AND escalated_at IS NULL;
" # Should be 0

# Breach rate metric
curl -s http://helpdesk:3027/ops/metrics | grep helpdesk_sla_breach_rate
```

**Communication template:**

> 🟠 **[P1] Helpdesk — SLA engine halted**  
> SLA breach detection not running for {N} minutes. {M} tickets past SLA without escalation.  
> Root cause: {scheduler dead | SLA policy missing | DB error}.  
> Support team not being alerted to breaches. Manual sweep triggered.  
> ETR: {5 min for restart + sweep}.

---

### FM-02: Auto-ticket from telephony/CRM/citizen not creating

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `helpdesk_auto_ticket_creation_rate` drop > 50% |
| **Impact** | Missed calls, CRM cases, citizen requests not getting helpdesk tickets — requests lost |

**Triage:**

```
Auto-ticket not creating
├── Which source is failing?
│   → curl -s http://helpdesk:3027/ops/consumer-status | jq '.consumers'
│   → Check each inbound consumer:
│   ├── telephony.call.missed consumer
│   │   → curl -s http://helpdesk:3027/ops/dlq/peek?topic=telephony.call.missed
│   │   ├── DLQ entries → Check payload. Missing required fields?
│   │   │   → Telephony event needs: caller number, queue ID
│   │   │   → If field missing: telephony-service changed payload
│   │   └── No DLQ → Consumer not receiving events
│   │       → Check telephony-service outbox relay
│   ├── crm.case.opened consumer
│   │   → curl -s http://helpdesk:3027/ops/dlq/peek?topic=crm.case.opened
│   │   → Check crm-service is publishing case events
│   ├── citizen.request.created consumer
│   │   → curl -s http://helpdesk:3027/ops/dlq/peek?topic=citizen.request.created
│   │   → Check citizen-service health
│   └── ml.prediction.breach_risk_high → Non-blocking (graceful degrade)
├── Is the helpdesk worker alive?
│   → curl -s http://helpdesk:3027/ops/heartbeat | jq .
└── Is ticket creation itself failing (regardless of source)?
    → curl -s http://helpdesk:3027/ops/dlq/peek?topic=helpdesk.ticket.create | jq .
    → If create command is DLQing, the problem is downstream (DB/validation)
```

**Commands:**

```bash
# Check all inbound consumers
curl -s http://helpdesk:3027/ops/consumer-status | jq '.consumers | to_entries[] | {topic: .key, lastProcessedAt: .value.lastProcessedAt}'

# Check DLQ for each inbound source
curl -s http://helpdesk:3027/ops/dlq/peek?topic=telephony.call.missed&limit=3 | jq .
curl -s http://helpdesk:3027/ops/dlq/peek?topic=crm.case.opened&limit=3 | jq .
curl -s http://helpdesk:3027/ops/dlq/peek?topic=citizen.request.created&limit=3 | jq .

# Check auto-ticket creation rate by source
psql civitas_helpdesk -c "
  SELECT source, COUNT(*), MAX(created_at) as latest
  FROM helpdesk.tickets
  WHERE created_at > NOW() - INTERVAL '24 hours'
  GROUP BY source
  ORDER BY count DESC;
"

# Verify source services are publishing events
curl -s http://telephony:3026/ops/outbox-relay | jq '.pendingCount'
curl -s http://crm:3024/ops/outbox-relay | jq '.pendingCount'
curl -s http://citizen:3020/ops/outbox-relay | jq '.pendingCount'

# Redrive DLQ for specific source (after fixing cause)
curl -X POST http://helpdesk:3027/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "telephony.call.missed", "batchSize": 10}'
```

**Verification after fix:**

```bash
# Auto-tickets being created again
psql civitas_helpdesk -c "
  SELECT source, COUNT(*) FROM helpdesk.tickets
  WHERE created_at > NOW() - INTERVAL '30 minutes'
  AND source IN ('telephony', 'crm', 'citizen')
  GROUP BY source;
"

# DLQ empty for inbound topics
curl -s http://helpdesk:3027/ops/dlq | jq '.topics[] | select(.depth > 0)'
```

**Communication template:**

> 🟡 **[P2] Helpdesk — Auto-ticket creation failing for {source}**  
> {source} events not creating helpdesk tickets. {N} events in DLQ.  
> Root cause: {payload schema change | consumer dead | source not publishing}.  
> {source} requests during outage queued safely. Will create on fix.  
> ETR: {5 min for redrive | coordination needed for schema change}.

---

### FM-03: Service request stuck at stage (multi-stage workflow)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `helpdesk_request_stage_pending_age > 7d` |
| **Impact** | Self-service requests (laptop, access, etc.) stuck — employee productivity impacted |

**Triage:**

```
Service request stuck
├── Which stage is it stuck at?
│   → psql civitas_helpdesk -c "SELECT id, catalogue_item, current_stage,
│      stage_entered_at, NOW() - stage_entered_at as stuck_duration
│      FROM helpdesk.service_requests
│      WHERE status = 'in_progress'
│      AND stage_entered_at < NOW() - INTERVAL '7 days'
│      ORDER BY stage_entered_at LIMIT 10;"
│   ├── Stage = 'approval' → Waiting on approver (business issue)
│   │   → Check workflow-service for the approval instance
│   │   → curl -s "http://workflow:3029/v1/workflow/instances?refType=service_request&refId={requestId}"
│   │   → If workflow instance not found → Creation failed. Check outbox.
│   │   → If workflow stuck → See workflow-service runbook
│   ├── Stage = 'procurement' → Waiting on procurement team
│   │   → Business process. Send reminder.
│   ├── Stage = 'delivery' → Item procured but not delivered
│   │   → Business process. Notify fulfilment team.
│   └── Stage = 'configuration' → IT setup pending
│       → Business process. Notify IT team.
├── Is the stage-advance event being consumed?
│   → curl -s http://helpdesk:3027/ops/dlq/peek?topic=helpdesk.request.stage_advanced | jq .
└── Was the SLA for this stage breached?
    → Check if breach escalation was triggered
    → psql: SELECT * FROM helpdesk.request_escalations WHERE request_id = '{id}';
```

**Commands:**

```bash
# Find stuck service requests
psql civitas_helpdesk -c "
  SELECT id, catalogue_item, current_stage, assigned_to,
         stage_entered_at, NOW() - stage_entered_at as stuck_duration
  FROM helpdesk.service_requests
  WHERE status = 'in_progress'
  AND stage_entered_at < NOW() - INTERVAL '7 days'
  ORDER BY stage_entered_at LIMIT 10;
"

# Check workflow instance for the request
curl -s "http://workflow:3029/v1/workflow/instances?refType=service_request&status=active" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {id, refId, currentStep}'

# Check DLQ for stage-advance events
curl -s http://helpdesk:3027/ops/dlq/peek?topic=helpdesk.request.stage_advanced&limit=5 | jq .

# Check breach escalation
psql civitas_helpdesk -c "
  SELECT request_id, stage, escalated_at, escalated_to
  FROM helpdesk.request_escalations
  WHERE request_id = '{requestId}'
  ORDER BY escalated_at DESC;
"

# Force stage advance (emergency — only with approval)
curl -X POST "http://helpdesk:3027/v1/helpdesk/requests/{requestId}/advance" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Manual advance — stuck in {stage} for {N} days"}'
```

**Verification after fix:**

```bash
# Request advanced
psql civitas_helpdesk -c "
  SELECT id, current_stage, status FROM helpdesk.service_requests
  WHERE id = '{requestId}';
"
```

**Communication template:**

> 🟡 **[P2] Helpdesk — Service request stuck at {stage}**  
> {N} requests stuck at '{stage}' stage for > 7 days.  
> Root cause: {approver not acting | workflow stuck | stage-advance DLQ}.  
> ETR: {immediate for DLQ fix | business escalation for approver}.

---

### FM-04: Consumer stalled (helpdesk-worker)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `helpdesk_worker_heartbeat_stale > 60s` |
| **Impact** | ALL helpdesk commands stop — SLA sweeps, ticket creation, auto-tickets, service requests |

**Commands:**

```bash
# Check worker heartbeat
curl -s http://helpdesk:3027/ops/heartbeat | jq .

# View error logs
docker logs civitasone-helpdesk-worker --tail=100 --since=5m 2>&1 | grep -E "ERROR|FATAL|OOM"

# Restart worker
docker restart civitasone-helpdesk-worker

# Verify recovery
sleep 5 && curl -s http://helpdesk:3027/ops/heartbeat | jq '.ageSeconds < 10'

# Immediately trigger SLA sweep after restart
curl -X POST http://helpdesk:3027/ops/sla-sweep-now

# Check DLQ for poison message
curl -s http://helpdesk:3027/ops/dlq | jq '.topics[] | select(.depth > 0)'
```

**Communication template:**

> 🟠 **[P1] Helpdesk worker stalled — commands not processing**  
> SLA sweeps, ticket creation, auto-tickets from telephony/CRM all paused.  
> Root cause: {OOM | poison message | DB connection exhaustion}.  
> Worker restarted. SLA sweep triggered. Queued events will process.  
> ETR: {5 min for restart + catch-up}.

---

## Rollback

```bash
# Docker
docker pull civitasone/helpdesk-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d helpdesk-service helpdesk-worker

# K8s
kubectl set image deployment/helpdesk-service \
  helpdesk=civitasone/helpdesk-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/helpdesk-worker \
  worker=civitasone/helpdesk-service:$PREVIOUS_TAG -n civitasone

# Verify health
curl -s http://helpdesk:3027/health | jq .

# Verify SLA sweep resumed
curl -s http://helpdesk:3027/ops/heartbeat | jq '.scheduledJobs.slaSweep'

# Verify all inbound consumers connected
curl -s http://helpdesk:3027/ops/consumer-status | jq '.consumers | keys'
```

**Note:** Ticket state transitions are logged in history (append-only). Rollback doesn't revert ticket states — history is preserved.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh helpdesk --target-time="2026-07-26T02:00:00Z"

# 2. Immediately run SLA sweep (recalculate breach timers)
curl -X POST http://helpdesk:3027/ops/sla-sweep-now

# 3. Check for tickets created during outage (from inbound sources)
psql civitas_helpdesk -c "
  SELECT source, COUNT(*) FROM helpdesk.tickets
  WHERE created_at > '2026-07-26T01:45:00Z'
  GROUP BY source;
"

# 4. Check for missed auto-tickets (compare with source event count)
# Telephony missed calls during gap:
curl -s "http://telephony:3026/v1/telephony/calls?status=missed&since=2026-07-26T01:45:00Z" \
  -H "Authorization: Bearer $TOKEN" | jq '.meta.total'

# 5. Replay outbox
curl -X POST http://helpdesk:3027/ops/outbox-relay/replay-pending

# 6. Verify SLA deadlines recalculated correctly
psql civitas_helpdesk -c "
  SELECT id, priority, sla_deadline, created_at
  FROM helpdesk.tickets
  WHERE status NOT IN ('resolved', 'closed')
  ORDER BY sla_deadline LIMIT 10;
"

# 7. Check service request stage integrity
psql civitas_helpdesk -c "
  SELECT id, current_stage, status FROM helpdesk.service_requests
  WHERE status = 'in_progress'
  ORDER BY stage_entered_at LIMIT 10;
"
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Helpdesk service restored**  
> DB restored to {timestamp}. SLA sweep recalculated breach timers.  
> {N} tickets created during gap verified. Auto-ticket sources reconnected.  
> Service request stages intact. Outbox replayed.
