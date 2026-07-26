# Runbook: crm-service

> **Tier 3** | SLO: 99.5% availability, p95 read < 300 ms, DLQ = 0  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** CRM Domain Owner | **Escalation:** SRE → CTO  
> **Slack:** `#incident-crm` | **PagerDuty:** `crm-standard`  

---

## Purpose

Stakeholder relationship management — contact/account management with merge/dedup, deal pipeline tracking (stage progression), activity logging, lead scoring (ml-service integration), custom fields, bulk contact import, and pipeline configuration. PII-heavy service (email, phone, address encrypted via `encryptedText()`). Owns `civitas_crm` on port 3024. If CRM is down, contact/deal management stops, lead scoring halts, and downstream helpdesk ticket creation from CRM cases fails.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_crm`) | `curl -s http://crm:3024/ready \| jq .checks.db` | Total outage — all CRM operations halt |
| Redis | `curl -s http://crm:3024/ready \| jq .checks.cache` | Degraded reads (contact lists, pipeline, lead scores) |
| SQS/RabbitMQ | `curl -s http://crm:3024/ready \| jq .checks.queue` | Commands stop, events not emitted |
| ml-service (lead scoring) | `curl -s http://ml:3032/health` | Lead scores not updated (graceful degrade — last score retained) |
| helpdesk-service (case consumer) | `curl -s http://helpdesk:3027/health` | CRM cases don't auto-create helpdesk tickets |
| PII encryption key | Env: `PII_ENCRYPTION_KEY` | Service won't start without valid key |

**Cross-service consumed:** `ml.prediction.lead_scored` (ml-service provides conversion probability)

**Cross-service produced:** `crm.case.opened` (→ helpdesk), `crm.lead.created`/`crm.lead.updated` (→ ml-service)

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| CRM Overview | `https://grafana.internal/d/crm-overview` | p95 latency, error rate, contact growth, deal velocity |
| DLQ Monitor | `https://grafana.internal/d/crm-dlq` | DLQ depth by topic (merge = high priority) |
| Lead Scoring | `https://grafana.internal/d/crm-leads` | Score distribution, ml-service prediction freshness |
| Pipeline Health | `https://grafana.internal/d/crm-pipeline` | Deals by stage, conversion rate, stuck deals |
| Bulk Import | `https://grafana.internal/d/crm-import` | Import job status, failure rate, batch progress |

---

## Failure Modes

### FM-01: Bulk contact import failing

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `crm_bulk_import_failure_rate > 20%` |
| **Impact** | Contact data not ingested — onboarding or migration blocked |

**Triage:**

```
Bulk import failing
├── Check import job status
│   → psql civitas_crm -c "SELECT id, status, total_rows, processed_rows, failed_rows,
│      error_message FROM crm.import_jobs WHERE status = 'failed'
│      AND created_at > NOW() - INTERVAL '2 hours' ORDER BY created_at DESC LIMIT 5;"
│   ├── "UNIQUE_CONSTRAINT_VIOLATION" → Duplicate email/phone in CSV
│   │   → Import is batch-based (1000/tx). Failed batch has duplicates.
│   │   → Import is resumable from failed batch number.
│   │   → Fix: deduplicate source CSV, resume from failed batch.
│   ├── "PII_ENCRYPTION_ERROR" → Encryption key mismatch or missing
│   │   → docker exec civitasone-crm env | grep PII_ENCRYPTION_KEY | sed 's/=.*/=***/'
│   │   → Key must be 32 bytes for AES-256-GCM
│   │   → FIX: verify key matches the one used in existing records
│   ├── "VALIDATION_ERROR" → Malformed data (invalid email format, missing required fields)
│   │   → Check the specific row that failed
│   │   → psql: SELECT details FROM crm.import_errors WHERE job_id = '{jobId}' LIMIT 10;
│   │   → Fix source CSV and re-upload
│   └── "MEMORY_EXCEEDED" → CSV too large for single processing
│       → Break CSV into smaller files (< 10000 rows each)
├── Was the import partially completed?
│   → Successfully imported batches are committed (not rolled back)
│   → Check: processed_rows vs total_rows
│   → Resume from: processed_rows + 1
└── Is the worker alive?
    → curl -s http://crm:3024/ops/consumer-status | jq '.consumers["crm.contact.bulk_import"]'
```

**Commands:**

```bash
# Check recent import jobs
psql civitas_crm -c "
  SELECT id, filename, status, total_rows, processed_rows, failed_rows,
         created_at, updated_at
  FROM crm.import_jobs
  WHERE created_at > NOW() - INTERVAL '24 hours'
  ORDER BY created_at DESC LIMIT 10;
"

# Check specific import errors
psql civitas_crm -c "
  SELECT row_number, field, error_message
  FROM crm.import_errors
  WHERE job_id = '{jobId}'
  ORDER BY row_number LIMIT 20;
"

# Check PII encryption key is valid
curl -s http://crm:3024/ready | jq '.checks.encryption'

# Check worker status
curl -s http://crm:3024/ops/consumer-status | jq '.consumers["crm.contact.bulk_import"]'

# Check DLQ for import commands
curl -s http://crm:3024/ops/dlq/peek?topic=crm.contact.bulk_import&limit=3 | jq .

# Resume a partially completed import
curl -X POST http://crm:3024/ops/import/resume \
  -H "Content-Type: application/json" \
  -d '{"jobId": "{jobId}", "fromBatch": {batchNumber}}'
```

**Verification after fix:**

```bash
# Import completing
psql civitas_crm -c "
  SELECT id, status, processed_rows, failed_rows FROM crm.import_jobs
  WHERE id = '{jobId}';
"

# New contacts accessible
curl -s "http://crm:3024/v1/crm/contacts?limit=5&sort=-createdAt" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'
```

**Communication template:**

> 🟡 **[P2] CRM — Bulk import failing**  
> Import job {jobId}: {processed}/{total} rows processed, {failed} failed.  
> Root cause: {duplicate constraint | PII key error | validation | memory}.  
> Partial import committed safely. Resumable from batch {N}.  
> ETR: {immediate for resume | source CSV fix needed}.

---

### FM-02: Lead score not updating (ml-service prediction stale)

| Field | Value |
|-------|-------|
| **Severity** | P3 |
| **Time to act** | < 2 hours |
| **Alert** | `crm_lead_score_staleness > 24h` |
| **Impact** | Sales team working with outdated lead priorities — reduced conversion efficiency |

**Triage:**

```
Lead scores stale
├── Is ml-service healthy?
│   → curl -s http://ml:3032/health | jq .
│   ├── Unhealthy → ml-service issue. CRM degrades gracefully.
│   │   → Lead scores retain last-computed value
│   │   → No action on CRM side. Check ml-service runbook.
│   └── Healthy → Events not flowing
│       ├── Is CRM publishing lead events?
│       │   → curl -s http://crm:3024/ops/outbox-relay | jq '.pendingCount'
│       │   → Check outbox for crm.lead.created / crm.lead.updated
│       ├── Is CRM consuming ml.prediction.lead_scored?
│       │   → curl -s http://crm:3024/ops/consumer-status | jq '.consumers["ml.prediction.lead_scored"]'
│       │   → Check DLQ: curl -s http://crm:3024/ops/dlq/peek?topic=ml.prediction.lead_scored
│       └── Check if the score update is failing silently
│           → psql civitas_crm -c "SELECT id, lead_score, score_updated_at FROM crm.contacts
│              WHERE lead_score IS NOT NULL ORDER BY score_updated_at DESC LIMIT 5;"
├── Were lead events published recently?
│   → psql civitas_crm -c "SELECT topic, COUNT(*), MAX(created_at) FROM crm.outbox
│      WHERE topic LIKE 'crm.lead%' AND created_at > NOW() - INTERVAL '24 hours'
│      GROUP BY topic;"
└── Is this affecting all tenants or one?
    → Single tenant: their lead activity may be below ml threshold
    → All tenants: system-level issue
```

**Commands:**

```bash
# Check lead score freshness
psql civitas_crm -c "
  SELECT tenant_id, COUNT(*) as leads,
         MAX(score_updated_at) as latest_score,
         NOW() - MAX(score_updated_at) as staleness
  FROM crm.contacts
  WHERE lead_score IS NOT NULL
  GROUP BY tenant_id
  ORDER BY staleness DESC LIMIT 10;
"

# Check ml-service health
curl -s http://ml:3032/health | jq .

# Check CRM consumer for ml predictions
curl -s http://crm:3024/ops/consumer-status | jq '.consumers["ml.prediction.lead_scored"]'

# Check DLQ for ml prediction events
curl -s http://crm:3024/ops/dlq/peek?topic=ml.prediction.lead_scored&limit=5 | jq .

# Check outbox for lead events going to ml
psql civitas_crm -c "
  SELECT topic, relayed_at, created_at FROM crm.outbox
  WHERE topic LIKE 'crm.lead%'
  ORDER BY created_at DESC LIMIT 10;
"

# Force lead score recalculation for specific leads
curl -X POST "http://crm:3024/v1/crm/leads/recalculate-scores" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tenantId": "{tenantId}", "limit": 100}'
```

**Verification after fix:**

```bash
# Scores updating
psql civitas_crm -c "
  SELECT id, lead_score, score_updated_at FROM crm.contacts
  WHERE lead_score IS NOT NULL
  ORDER BY score_updated_at DESC LIMIT 5;
"

# Consumer processing
curl -s http://crm:3024/ops/metrics | grep crm_lead_score_updated_total
```

**Communication template:**

> 🔵 **[P3] CRM — Lead scores stale ({N}h behind)**  
> ml-service predictions not flowing to CRM. Scores retain last-computed value.  
> Root cause: {ml-service down | consumer stalled | outbox not relaying lead events}.  
> No data loss — scores will update when flow resumes. Sales team advised.  
> ETR: {depends on ml-service | 5 min for consumer restart}.

---

### FM-03: Contact merge conflict / partial merge

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 15 min |
| **Alert** | `crm_dlq_depth{topic="crm.contact.merge"} > 0` |
| **Impact** | Duplicate contacts persist, activities may be incorrectly attributed |

**Triage:**

```
Contact merge DLQ
├── DO NOT blindly redrive — inspect for partial completion first!
│   → curl -s http://crm:3024/ops/dlq/peek?topic=crm.contact.merge&limit=3 | jq .
├── Check if merge partially completed
│   → Read payload: sourceContactId, targetContactId
│   → psql civitas_crm -c "SELECT id, status, merged_into FROM crm.contacts WHERE id = '{sourceId}';"
│   ├── source deleted_at set → Activities might not have transferred
│   │   → Check: psql -c "SELECT contact_id, COUNT(*) FROM crm.activities
│   │      WHERE contact_id = '{sourceId}' GROUP BY contact_id;"
│   │   → If activities still on source → Manual transfer needed
│   │   → psql -c "UPDATE crm.activities SET contact_id = '{targetId}' WHERE contact_id = '{sourceId}';"
│   └── source still active → Merge didn't start. Safe to retry after fixing cause.
├── Read the error
│   ├── "PIPELINE_CONFLICT" → Both contacts have deals in same pipeline+stage
│   │   → Move one deal to different stage, then retry merge
│   ├── "VERSION_MISMATCH" → Contact updated during merge attempt
│   │   → Retry with latest version (safe)
│   └── "ENCRYPTION_ERROR" → PII fields can't be decrypted/re-encrypted
│       → Key rotation issue. Check PII_ENCRYPTION_KEY.
└── Is this a single merge or bulk de-duplication run?
    → Bulk: many merge commands queued. One failure shouldn't block others.
    → Each merge is independent.
```

**Commands:**

```bash
# Peek at merge DLQ
curl -s http://crm:3024/ops/dlq/peek?topic=crm.contact.merge&limit=5 | jq '.[0] | {error, sourceId: .payload.sourceContactId, targetId: .payload.targetContactId}'

# Check merge status (was it partial?)
psql civitas_crm -c "
  SELECT id, email, status, deleted_at, merged_into
  FROM crm.contacts
  WHERE id IN ('{sourceId}', '{targetId}');
"

# Check if activities were transferred
psql civitas_crm -c "
  SELECT contact_id, COUNT(*) as activity_count
  FROM crm.activities
  WHERE contact_id IN ('{sourceId}', '{targetId}')
  GROUP BY contact_id;
"

# Manual activity transfer (if partial merge detected)
psql civitas_crm -c "
  UPDATE crm.activities SET contact_id = '{targetId}'
  WHERE contact_id = '{sourceId}';
"

# Redrive (only after understanding cause and fixing)
curl -X POST http://crm:3024/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "crm.contact.merge", "batchSize": 1}'
```

**Verification after fix:**

```bash
# Source contact properly merged
psql civitas_crm -c "
  SELECT id, merged_into, deleted_at FROM crm.contacts WHERE id = '{sourceId}';
"

# All activities on target
psql civitas_crm -c "
  SELECT COUNT(*) FROM crm.activities WHERE contact_id = '{sourceId}';
" # Should be 0

# DLQ clear
curl -s http://crm:3024/ops/dlq | jq '.topics[] | select(.topic == "crm.contact.merge")'
```

**Communication template:**

> 🟠 **[P1] CRM — Contact merge failed (potential partial merge)**  
> Merge DLQ depth: {N}. Source: {sourceId} → Target: {targetId}.  
> Root cause: {pipeline conflict | version mismatch | encryption error}.  
> DO NOT redrive without inspection — partial merge possible.  
> ETR: {15 min for manual reconciliation | 5 min for version retry}.

---

### FM-04: Consumer stalled (crm-worker)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `crm_worker_heartbeat_stale > 60s` |
| **Impact** | Contact/deal commands stop, ml scores not consumed, cases not opened |

**Commands:**

```bash
# Check worker heartbeat
curl -s http://crm:3024/ops/heartbeat | jq .

# View error logs
docker logs civitasone-crm-worker --tail=100 --since=5m 2>&1 | grep -E "ERROR|FATAL|OOM"

# Restart worker
docker restart civitasone-crm-worker

# Verify recovery
sleep 5 && curl -s http://crm:3024/ops/heartbeat | jq '.ageSeconds < 10'

# Check DLQ for poison message that may have caused crash
curl -s http://crm:3024/ops/dlq | jq '.topics[] | select(.depth > 0)'
```

**Communication template:**

> 🟠 **[P1] CRM worker stalled — commands not processing**  
> Contact/deal operations, lead scoring intake, bulk imports all paused.  
> Root cause: {OOM | poison message | DB connection}. Worker restarted.  
> ETR: {5 min for restart}.

---

## Rollback

```bash
# Docker
docker pull civitasone/crm-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d crm-service crm-worker

# K8s
kubectl set image deployment/crm-service \
  crm=civitasone/crm-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/crm-worker \
  worker=civitasone/crm-service:$PREVIOUS_TAG -n civitasone

# Verify health
curl -s http://crm:3024/health | jq .

# Verify PII encryption still works (key compatibility)
curl -s http://crm:3024/ready | jq '.checks.encryption'

# Verify consumers
curl -s http://crm:3024/ops/consumer-status | jq '.consumers | keys'
```

**Caution:** Contact merges are difficult to reverse (activities re-parented, source soft-deleted). If a bad merge occurred on the new version, targeted tenant restore from backup may be needed.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh crm --target-time="2026-07-26T02:00:00Z"

# 2. Verify PII encryption key matches restored data
curl -s http://crm:3024/ready | jq '.checks.encryption'

# 3. Check for contacts created during gap (may be lost)
psql civitas_crm -c "
  SELECT COUNT(*) FROM crm.contacts
  WHERE created_at > '2026-07-26T01:45:00Z';
"

# 4. Verify deal pipeline integrity
psql civitas_crm -c "
  SELECT p.name, COUNT(d.id) as deals FROM crm.pipelines p
  LEFT JOIN crm.deals d ON d.pipeline_id = p.id
  GROUP BY p.name ORDER BY deals DESC;
"

# 5. Replay outbox (idempotent)
curl -X POST http://crm:3024/ops/outbox-relay/replay-pending

# 6. Re-trigger lead score recalculation (scores may be stale post-restore)
curl -X POST "http://crm:3024/v1/crm/leads/recalculate-scores" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"all": true}'

# 7. Verify no orphaned activities (contacts deleted but activities remain)
psql civitas_crm -c "
  SELECT a.id, a.contact_id FROM crm.activities a
  LEFT JOIN crm.contacts c ON c.id = a.contact_id
  WHERE c.id IS NULL LIMIT 10;
"
```

**Post-recovery communication:**

> ✅ **[RESOLVED] CRM service restored**  
> DB restored to {timestamp}. PII encryption verified.  
> {N} contacts created during gap may need re-entry.  
> Lead scores recalculating. Deal pipeline intact. Outbox replayed.
