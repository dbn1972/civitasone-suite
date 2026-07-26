# Runbook: workflow-service

> **Tier 1** | SLO: 99.9% availability, p95 read < 300 ms, task assignment < 5s, DLQ = 0  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Platform Engineering (Workflow) | **Escalation:** SRE → CTO  
> **Slack:** `#incident-workflow` | **PagerDuty:** `workflow-critical`  

---

## Purpose

Cross-service approval/maker-checker orchestration engine — manages workflow definitions (multi-step approval chains), instance lifecycle (create/cancel/suspend/resume), task assignment (role-based + strategy: round-robin/least-loaded/hierarchy), SLA enforcement with due-date computation, decision history (immutable audit trail), delegations, quorum rules, BPMN/DMN evaluation, case registry, compensation/rollback flows, and DLQ management. Owns `civitas_workflow`. If workflow is down, ALL maker-checker approvals across the platform are blocked.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_workflow`) | `curl -s http://workflow:3029/ready \| jq .checks.db` | Total outage |
| Redis | `curl -s http://workflow:3029/ready \| jq .checks.cache` | Degraded reads (instance/task lookups slow) |
| SQS/RabbitMQ | `curl -s http://workflow:3029/ready \| jq .checks.queue` | No new approvals created, no tasks assigned |

**Cross-service consumed:** Every service publishes `workflow.instance.create` to initiate approval flows. Major producers: finance (sanctions, bills), procurement (indents, POs, tenders), hrms (leave, claims), estab (file noting), contract (approval levels).

**Cross-service produced:** `workflow.instance.created/completed/rejected`, `workflow.task.assigned/completed`, consumed by notification-service (task alerts) and all source services (decision callbacks).

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Workflow Overview | `https://grafana.internal/d/workflow-overview` | Instance throughput, task completion rate, p95 |
| DLQ Monitor | `https://grafana.internal/d/workflow-dlq` | DLQ depth, dead-lettered messages by topic |
| SLA Compliance | `https://grafana.internal/d/workflow-sla` | Overdue tasks, SLA breach rate by definition |
| Assignment Health | `https://grafana.internal/d/workflow-assignment` | Unassigned tasks, assignment strategy effectiveness |

---

## Failure Modes

### FM-01: Instance creation failing (approvals not starting)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `workflow_dlq_depth{topic="workflow.instance.create"} > 0` |
| **Impact** | New approval workflows don't start — sanctions/POs/leaves blocked |

**Triage:**

```
Instance creation DLQ
├── Read DLQ error message
│   → curl -s http://workflow-worker:3029/ops/dlq/peek?topic=workflow.instance.create&limit=5 | jq '.[0].error'
│   ├── "unknown_definition" (definitionCode not found for tenant)
│   │   → The source service requested a workflow definition that doesn't exist.
│   │   → This is R13 fail-closed behavior (correct — no rubber-stamp path).
│   │   → FIX: Create the definition for this tenant via admin, OR accept rejection.
│   │   → Instance is persisted as "rejected" with reason "unknown_definition".
│   │   → DO NOT redrive — the consumer correctly created a rejected instance.
│   ├── "TENANT_NOT_FOUND" / RLS violation
│   │   → Tenant context mismatch. Check if tenantId in message is valid.
│   │   → Verify tenant exists: psql civitas_tenant -c "SELECT id FROM tenant.tenants WHERE id = '<tid>';"
│   ├── "OPTIMISTIC_LOCK_CONFLICT" (version mismatch)
│   │   → Concurrent instance creation for same entity. Safe to redrive (idempotent).
│   └── "DB_ERROR" / connection issue
│       → Check workflow DB health: curl -s http://workflow:3029/ready | jq .checks.db
│       → If DB is back, safe to redrive all.
```

**Commands:**

```bash
# Peek at DLQ messages
curl -s http://workflow-worker:3029/ops/dlq/peek?topic=workflow.instance.create&limit=10 | jq '.'

# Check workflow definition exists for a tenant
psql civitas_workflow -c "
  SELECT code, version, status FROM workflow.definitions
  WHERE tenant_id = '<tenantId>' AND code = '<definitionCode>';
"

# Redrive safe messages (after DB/connectivity fix)
curl -X POST http://workflow-worker:3029/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "workflow.instance.create", "batchSize": 50}'

# Check how many instances are waiting
psql civitas_workflow -c "
  SELECT status, COUNT(*) FROM workflow.instances
  WHERE created_at > NOW() - INTERVAL '1 hour'
  GROUP BY status;
"
```

**Verification after fix:**

```bash
# DLQ depth back to zero
curl -s http://workflow-worker:3029/ops/dlq | jq '.depth'

# New instances being created (increasing count)
watch -n5 'psql civitas_workflow -c "SELECT COUNT(*) FROM workflow.instances WHERE created_at > NOW() - INTERVAL 5 min;" -t'

# Task assignment working (tasks created with assignees)
psql civitas_workflow -c "
  SELECT COUNT(*), COUNT(assignee_id) AS assigned
  FROM workflow.tasks WHERE created_at > NOW() - INTERVAL '10 min';
"
```

---

### FM-02: Tasks not being assigned (unassigned tasks accumulating)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 15 min |
| **Alert** | `workflow_unassigned_tasks_count > 50` for 10 min |
| **Impact** | Approvals stuck — no one sees the pending task |

**Triage:**

```
Unassigned tasks accumulating
├── Check assignment strategy for the definition's start node
│   → psql civitas_workflow -c "SELECT node_key, assign_strategy, role_ref
│      FROM workflow.definition_nodes WHERE definition_id = '<defId>';"
│   ├── strategy = "none" → Definition intentionally doesn't auto-assign. Expected.
│   │   → Tasks are picked up manually by role holders.
│   └── strategy = "round_robin" / "least_loaded" / "hierarchy"
│       → Assignment resolver should have assigned. Check:
│       → Are there users with the required role?
│       → psql civitas_policy -c "SELECT user_id FROM policy.bindings
│          WHERE role_id = '<roleRef>' AND tenant_id = '<tenantId>' AND revoked_at IS NULL;"
│       ├── No users with role → RBAC gap. Assign role to an officer.
│       └── Users exist → Assignment resolver may be failing silently.
│           → Check workflow-worker logs for "resolveAssignee" errors.
│           → grep "resolveAssignee" /var/log/workflow-service/*.log | tail -10
```

**Commands:**

```bash
# Count unassigned tasks by definition
psql civitas_workflow -c "
  SELECT d.code, COUNT(t.id) AS unassigned
  FROM workflow.tasks t
  JOIN workflow.instances i ON t.instance_id = i.id
  LEFT JOIN workflow.definitions d ON i.definition_id = d.id
  WHERE t.assignee_id IS NULL AND t.status = 'pending'
  GROUP BY d.code ORDER BY unassigned DESC LIMIT 10;
"

# Check who has the required role (for a specific task)
psql civitas_policy -c "
  SELECT user_id FROM policy.bindings
  WHERE role_id = (SELECT role_ref FROM workflow.tasks WHERE id = '<taskId>')
  AND tenant_id = '<tenantId>' AND revoked_at IS NULL;
"

# Manually assign a critical task (emergency)
curl -X POST "http://workflow:3029/v1/workflow/tasks/<taskId>/assign" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"assigneeId": "<userId>"}'
```

---

### FM-03: Lifecycle transition rejected (cancel/suspend/resume failing)

| Field | Value |
|-------|-------|
| **Severity** | P3 |
| **Time to act** | N/A (usually correct behavior) |
| **Alert** | N/A (logged as WARN) |

**Triage:**

```
Transition rejected
├── Check current instance status
│   → psql civitas_workflow -c "SELECT status FROM workflow.instances WHERE id = '<id>';"
│   ├── "completed" or "rejected" → Terminal state. Cannot cancel/suspend. Expected.
│   ├── "suspended" + trying to suspend again → Already suspended. Idempotent skip.
│   └── "active" + cancel rejected → Version mismatch (optimistic lock)
│       → The instance was modified between the command publish and processing.
│       → Retry with fresh version: fetch instance, re-submit with current version.
```

---

### FM-04: DLQ wrapping catching poison messages

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `workflow_dlq_depth > 0` |
| **Impact** | Specific workflows stuck (not platform-wide) |

**Commands:**

```bash
# Peek at all DLQ messages across all workflow topics
curl -s http://workflow-worker:3029/ops/dlq/peek?limit=20 | jq '.[].topic' | sort | uniq -c

# Inspect specific message
curl -s http://workflow-worker:3029/ops/dlq/peek?topic=<topic>&limit=1 | jq '.[0]'

# Redrive a batch (safe — markProcessed ensures idempotency)
curl -X POST http://workflow-worker:3029/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "<topic>", "batchSize": 10}'

# Acknowledge/discard poison messages (after investigation)
curl -X POST http://workflow-worker:3029/ops/dlq/ack \
  -H "Content-Type: application/json" \
  -d '{"messageIds": ["<id1>", "<id2>"]}'
```

---

### FM-05: SLA breaches accumulating

| Field | Value |
|-------|-------|
| **Severity** | P2 (business process issue, not system failure) |
| **Time to act** | < 1 hour |
| **Alert** | `workflow_sla_breached_tasks > 20` |
| **Impact** | Approvals overdue — statutory deadlines may be missed |

**Commands:**

```bash
# List overdue tasks by definition
psql civitas_workflow -c "
  SELECT d.code, t.name, t.due_at, NOW() - t.due_at AS overdue_by
  FROM workflow.tasks t
  JOIN workflow.instances i ON t.instance_id = i.id
  LEFT JOIN workflow.definitions d ON i.definition_id = d.id
  WHERE t.status = 'pending' AND t.due_at < NOW()
  ORDER BY overdue_by DESC LIMIT 20;
"

# Check if SLA sweep is running (should fire periodic escalations)
curl -s http://workflow-worker:3029/ops/scheduled-jobs | jq '.[] | select(.name == "sla_sweep")'

# Force SLA sweep run (if scheduled job missed)
curl -X POST http://workflow-worker:3029/ops/sla-sweep/trigger
```

---

## Rollback

```bash
# Docker
docker pull civitasone/workflow-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d workflow-service workflow-worker

# K8s
kubectl set image deployment/workflow-service \
  workflow=civitasone/workflow-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/workflow-worker \
  worker=civitasone/workflow-service:$PREVIOUS_TAG -n civitasone

# Verify
curl -s http://workflow:3029/health | jq .
```

**Caution:** In-flight instances reference definition versions. Rolling back code doesn't revert definitions (DB rows). If a migration added new definition columns, ensure backward compatibility.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh workflow --target-time="<timestamp>"

# 2. Replay outbox
curl -X POST http://workflow-worker:3029/ops/outbox-relay/replay-pending

# 3. Verify instance counts match expectations
psql civitas_workflow -c "
  SELECT status, COUNT(*) FROM workflow.instances GROUP BY status;
"

# 4. Verify no orphaned tasks (tasks without valid instances)
psql civitas_workflow -c "
  SELECT t.id FROM workflow.tasks t
  LEFT JOIN workflow.instances i ON t.instance_id = i.id
  WHERE i.id IS NULL;
"

# 5. Rebuild cache (instance/task views)
curl -X POST http://workflow-worker:3029/ops/cache/rebuild?resource=instance
curl -X POST http://workflow-worker:3029/ops/cache/rebuild?resource=task

# 6. Trigger SLA sweep (recalculate due dates for any tasks created during gap)
curl -X POST http://workflow-worker:3029/ops/sla-sweep/trigger
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Workflow service restored**  
> DB restored to {timestamp}. Outbox replayed. {N} active instances, {M} pending tasks.  
> SLA sweep re-triggered. No approval decisions lost.
