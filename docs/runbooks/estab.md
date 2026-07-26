# Runbook: estab-service

> **Tier 1** | SLO: 99.9% availability, p95 read < 500 ms, command commit < 5s, zero hash-chain breaks  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Estab Domain Owner | **Escalation:** Security → SRE → CTO  
> **Slack:** `#incident-estab` | **PagerDuty:** `estab-critical`  

---

## Purpose

Government file/noting lifecycle (DAK receive → File create → Note → Approve → Dispatch), committee/meeting management, RTI processing, records retention/weed-out, and facilities booking (vehicle/guesthouse/library). Tamper-evident hash chain on every noting (CERT-In Directions 2022). eOffice callback routing to source modules (finance, HRMS) on file decisions. Owns `civitas_estab`.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_estab`) | `curl -s http://estab:3010/ready \| jq .checks.db` | Total outage |
| Redis | `curl -s http://estab:3010/ready \| jq .checks.cache` | Degraded reads (file/noting queries) |
| SQS/RabbitMQ | `curl -s http://estab:3010/ready \| jq .checks.queue` | Noting/file commands stop |
| @civitasone/render (DSC signing) | `curl -s http://estab:3010/ops/circuit-breakers \| jq .render` | Noting signature fails |
| @civitasone/eoffice-sdk | N/A (library, not external) | Callback routing broken |
| Citizen-service (RTI source) | `curl -s http://citizen:3020/health` | New RTI filings not received |

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Estab Overview | `https://grafana.internal/d/estab-overview` | p95 latency, file lifecycle, error rate |
| DLQ Monitor | `https://grafana.internal/d/estab-dlq` | DLQ depth (especially noting topics) |
| Hash Chain Health | `https://grafana.internal/d/estab-hashchain` | Noting chain integrity per file |
| RTI SLA | `https://grafana.internal/d/estab-rti` | RTI response SLA compliance |

---

## Failure Modes

### FM-01: Noting hash chain verification failure (SECURITY)

| Field | Value |
|-------|-------|
| **Severity** | P0 (SECURITY/COMPLIANCE) |
| **Time to act** | IMMEDIATE |
| **Alert** | `estab_noting_hash_chain_failure` |
| **Impact** | CERT-In tamper-evidence broken — potential compliance incident |

**Triage:**

```
Noting hash chain break
├── Was this during a concurrent-write race?
│   → Two officers signing on same file simultaneously
│   ├── Yes → Bug (not tampering). Still P0 — chain is broken.
│   │   → Check file's noting history for duplicate chain_seq
│   │   → psql: SELECT noting_id, chain_seq, signed_at FROM estab.notings
│   │      WHERE file_id = '{fileId}' ORDER BY chain_seq;
│   └── No → POTENTIAL TAMPERING
│       → DO NOT modify any rows
│       → Preserve evidence (DB snapshot, access logs)
│       → Escalate to Security + Legal immediately
├── Identify break point
│   → Which file? Which noting? What's the expected vs actual hash?
│   → computeNotingHash(notingId, body, officerId, prevHash, signedAtMs)
└── Was a DLQ noting-sign message partially retried?
    → A partial retry that advanced chain_seq without prev_hash match
    → This is a known race condition risk on noting commands
```

**Commands:**

```bash
# Check chain integrity for a specific file
psql civitas_estab -c "
  SELECT n.id, n.chain_seq, n.prev_hash, n.hash, n.signed_at,
         n.officer_id
  FROM estab.notings n
  WHERE n.file_id = '{fileId}'
  ORDER BY n.chain_seq;
"

# Verify hash computation (manual check)
psql civitas_estab -c "
  SELECT id, 
    encode(digest(
      concat(id::text, body_hash, officer_id::text, prev_hash, 
             EXTRACT(epoch FROM signed_at)::bigint::text), 
      'sha256'), 'hex') as computed,
    hash as stored
  FROM estab.notings
  WHERE file_id = '{fileId}'
  ORDER BY chain_seq;
"

# Check for concurrent writes on same file
psql civitas_estab -c "
  SELECT file_id, chain_seq, COUNT(*)
  FROM estab.notings
  GROUP BY file_id, chain_seq
  HAVING COUNT(*) > 1;
"

# Snapshot evidence
pg_dump civitas_estab -t estab.notings --data-only > /tmp/noting-evidence-$(date +%s).sql
```

**Do NOT:**
- Do NOT attempt to repair the chain manually
- Do NOT delete or modify any noting rows
- Do NOT redrive DLQ messages that failed with hash errors

**Communication template:**

> 🔴 **[P0 — SECURITY] Noting hash chain integrity failure**  
> File {fileId}: chain broken at noting {notingId} (chain_seq {N}).  
> Possible cause: {concurrent write race | tampering | DLQ retry corruption}.  
> Evidence preserved. Security team notified. No automated repair attempted.

---

### FM-02: Consumer stalled (estab-worker)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `estab_worker_heartbeat_stale > 60s` |
| **Impact** | File/noting commands, RTI processing, eOffice callbacks all stop |

**Triage:**

```
Worker heartbeat stale
├── Check worker process
│   → docker ps --filter "name=estab-worker"
│   ├── Dead → Check crash logs, restart
│   └── Alive → Check DB / consumer status
│       → curl -s http://estab:3010/ready | jq .checks.db
│       → curl -s http://estab-worker:3010/ops/consumer-status | jq .
```

**Commands:**

```bash
# Check worker heartbeat
curl -s http://estab-worker:3010/ops/heartbeat | jq .

# View recent logs
docker logs civitasone-estab-worker --tail=100 --since=5m 2>&1 | grep -E "ERROR|FATAL"

# Restart worker (Docker)
docker restart civitasone-estab-worker

# Restart worker (K8s)
kubectl rollout restart deployment/estab-worker -n civitasone

# Check DLQ
curl -s http://estab-worker:3010/ops/dlq | jq .depth
```

**Verification after fix:**

```bash
curl -s http://estab-worker:3010/ops/heartbeat | jq '.ageSeconds < 10'
curl -s http://estab-worker:3010/ops/dlq | jq '.depth == 0'
```

**Communication template:**

> 🟡 **[P1] Estab worker stalled — file/noting commands not processing**  
> File approvals, RTI responses, eOffice callbacks queued safely.  
> Root cause: {OOM | DB | poison message}. ETR: {5 min for restart}.

---

### FM-03: DLQ filling on `estab.noting.*`

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `estab_dlq_depth{topic=~"estab.noting.*"} > 0` |
| **Impact** | Green notes not being recorded — file workflow stuck |

**Triage:**

```
DLQ on noting commands
├── "VALIDATION_ERROR" → Malformed noting body from upstream
│   → Fix the submitting client/module
├── "PREV_HASH_MISMATCH" → Chain seq conflict
│   → CRITICAL: DO NOT redrive blindly
│   → Check if chain_seq was already advanced by partial retry
│   → Verify current chain head: SELECT MAX(chain_seq) FROM estab.notings WHERE file_id=...
├── "DSC_SIGNING_ERROR" → Certificate issue
│   → Check DSC config, certificate expiry
│   → Redrive after DSC is fixed (signing is deterministic)
├── "DB_ERROR" / "TIMEOUT" → Transient
│   → Check DB health, then redrive
└── Unknown → Escalate (noting integrity at stake)
```

**Commands:**

```bash
# Peek DLQ
curl -s http://estab-worker:3010/ops/dlq/peek?topic=estab.noting.sign&limit=5 | jq .

# Check current chain head for the affected file
psql civitas_estab -c "
  SELECT MAX(chain_seq) as head, COUNT(*) as total_notings
  FROM estab.notings
  WHERE file_id = '{fileId}';
"

# Redrive (ONLY for transient errors, NEVER for hash conflicts)
curl -X POST http://estab-worker:3010/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "estab.noting.sign", "batchSize": 5}'
```

---

### FM-04: RTI SLA sweep overdue

| Field | Value |
|-------|-------|
| **Severity** | P2 (COMPLIANCE) |
| **Time to act** | < 1 hour |
| **Alert** | `estab_rti_overdue_count` increasing |
| **Impact** | Statutory RTI response deadlines being missed |

**Commands:**

```bash
# Check overdue RTI applications
psql civitas_estab -c "
  SELECT id, tenant_id, filed_at, due_date, status
  FROM estab.rti_applications
  WHERE status = 'pending' AND due_date < NOW()
  ORDER BY due_date LIMIT 20;
"

# Check RTI sweep job status
curl -s http://estab-worker:3010/ops/heartbeat | jq '.scheduledJobs.rtiSweep'

# Check if sweep worker is running
docker logs civitasone-estab-worker --since=2h 2>&1 | grep "rti.*sweep" | tail -10

# Force RTI SLA check
curl -X POST http://estab:3010/ops/rti-sweep-now

# Check notification was sent for overdue RTIs
curl -s "http://notification:3006/ops/metrics" | grep "rti_overdue"
```

---

### FM-05: eOffice callback not delivered to source module

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | Manual report (approval stuck in source module) |
| **Impact** | Finance/HRMS file decisions not reaching source module |

**Commands:**

```bash
# Check outbox relay for pending decision events
curl -s http://estab-worker:3010/ops/outbox-relay | jq '.pendingCount'

# Check pending callback events in outbox
psql civitas_estab -c "
  SELECT id, topic, payload->>'source_ref_type' as ref_type, created_at
  FROM estab.outbox
  WHERE relayed_at IS NULL AND topic LIKE '%file_decided%'
  ORDER BY created_at DESC LIMIT 10;
"

# Check MODULE_CALLBACK_TOPICS routing
docker logs civitasone-estab-worker --since=1h 2>&1 | grep "callback" | grep "route" | tail -10

# Force outbox relay restart
curl -X POST http://estab-worker:3010/ops/outbox-relay/restart

# Verify target module received the callback
# Example for HRMS transfer decision:
curl -s http://hrms-worker:3012/ops/consumer-status | jq '.topics[] | select(.name | contains("file_decided"))'
```

---

## Rollback

```bash
# Docker
docker pull civitasone/estab-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d estab-service estab-worker

# K8s
kubectl set image deployment/estab-service \
  estab=civitasone/estab-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/estab-worker \
  worker=civitasone/estab-service:$PREVIOUS_TAG -n civitasone

# Verify health
curl -s http://estab:3010/health | jq .
```

**CRITICAL:** Never attempt to "fix" a noting hash-chain row directly in the DB. A schema-level rollback of noting/file tables requires restore-from-backup plus chain re-verification.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min + chain verification

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh estab --target-time="2026-07-26T02:00:00Z"

# 2. Verify noting hash chain end-to-end for files touched since backup
psql civitas_estab -c "
  SELECT DISTINCT file_id FROM estab.notings
  WHERE signed_at > '2026-07-26T01:45:00Z';
" | while read file_id; do
  echo "Verifying chain for file: $file_id"
  curl -s http://estab:3010/ops/verify-chain/$file_id | jq '.valid'
done

# 3. Replay outbox
curl -X POST http://estab-worker:3010/ops/outbox-relay/replay-pending

# 4. Verify RTI SLA state
psql civitas_estab -c "
  SELECT status, COUNT(*) FROM estab.rti_applications
  WHERE due_date > '2026-07-26T01:00:00Z'
  GROUP BY status;
"

# 5. Verify audit continuity
curl -s "http://audit:3004/v1/audit/events?service=estab&since=2026-07-26T01:00:00Z" \
  -H "Authorization: Bearer $TOKEN" | jq '.meta.total'

# 6. Verify eOffice callback queue is clear
curl -s http://estab-worker:3010/ops/outbox-relay | jq '.pendingCount'
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Estab service restored**  
> DB restored to {timestamp}. Noting hash chains verified intact for {N} files.  
> Outbox replayed. RTI SLA state consistent. eOffice callbacks flowing.  
> No tamper-evidence gaps. Audit trail continuous.
