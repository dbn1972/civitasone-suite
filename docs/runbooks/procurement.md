# Runbook: procurement-service

> **Tier 2 (candidate Tier 1)** | SLO: 99.9% availability, p95 read < 400 ms, tender lifecycle integrity, DLQ = 0  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Procurement Domain Owner | **Escalation:** SRE → CTO  
> **Slack:** `#incident-procurement` | **PagerDuty:** `procurement-critical`  

---

## Purpose

End-to-end government procurement lifecycle: indent management, vendor registration/blacklisting, purchase orders, GRN (goods receipt), tendering (NIT/RFQ/RFP), e-auction, EMD/PBG (earnest money/performance bank guarantee), procurement planning, GeM integration, rate contracts, 3-way matching, and CPPP compliance. Owns `civitas_procurement` on port 3008. If procurement is down, indents cannot be raised, tenders freeze, POs cannot be issued, GRN acceptance halts (blocking stock/asset/finance downstream), and vendor payments are delayed.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_procurement`) | `curl -s http://procurement:3008/ready \| jq .checks.db` | Total outage — all procurement operations halt |
| Redis | `curl -s http://procurement:3008/ready \| jq .checks.cache` | Degraded reads (fallthrough to DB) |
| SQS/RabbitMQ | `curl -s http://procurement:3008/ready \| jq .checks.queue` | Commands stop processing, events not emitted |
| GeM Portal | `curl -s http://procurement:3008/ops/circuit-breakers \| jq .gem` | GeM item sync/ordering offline (circuit-breaker protected) |
| CPPP (Central Public Procurement Portal) | Manual check | Tender publication to CPPP delayed |
| eOffice (decision callbacks) | `curl -s http://estab:3010/ready` | Approval callbacks not received — tenders/POs stuck in approval |
| Finance-service (3-way match) | `curl -s http://finance:3007/health` | GRN→Bill matching delayed |
| Stock-service (GRN downstream) | `curl -s http://stock:3011/health` | GRN acceptance doesn't update stock |
| Asset-service (GRN downstream) | `curl -s http://asset:3015/health` | Capital GRN doesn't register assets |

**Cross-service consumed:** `estab.file.decision` (eOffice approval callbacks)

**Cross-service produced:** `procurement.grn.accepted` (→ stock, asset, finance), `procurement.po.approved` (→ analytics), `procurement.tender.awarded`, `procurement.vendor.blacklisted`

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Procurement Overview | `https://grafana.internal/d/procurement-overview` | p95 latency, error rate, active tenders, PO volume |
| DLQ Monitor | `https://grafana.internal/d/procurement-dlq` | DLQ depth by topic, EMD/PBG financial topics |
| GeM Integration | `https://grafana.internal/d/procurement-gem` | GeM sync status, circuit breaker, order success rate |
| Tender Lifecycle | `https://grafana.internal/d/procurement-tenders` | Tender funnel (draft → published → evaluated → awarded) |
| Vendor Health | `https://grafana.internal/d/procurement-vendors` | Registration rate, blacklist propagation, compliance |

---

## Failure Modes

### FM-01: Tender award stuck in approval workflow

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 15 min |
| **Alert** | `procurement_tender_award_pending_age > 3600s` |
| **Impact** | Tender cannot be awarded — procurement timeline breached, vendor commitments at risk |

**Triage:**

```
Tender award stuck
├── Is it waiting for eOffice decision callback?
│   → psql civitas_procurement -c "SELECT t.id, t.status, t.eoffice_file_id
│      FROM procurement.tenders t
│      WHERE t.status = 'pending_award_approval'
│      AND t.updated_at < NOW() - INTERVAL '1 hour';"
│   ├── eoffice_file_id present → Waiting on eOffice
│   │   → Check eOffice file status: curl -s http://estab:3010/v1/estab/files/{fileId}/status
│   │   ├── File approved but callback not received
│   │   │   → Check event propagation: estab.file.decision topic
│   │   │   → Check DLQ: curl -s http://procurement:3008/ops/dlq/peek?topic=estab.file.decision
│   │   │   → FIX: Redrive DLQ or manually trigger callback replay
│   │   └── File still pending in eOffice → Not a system issue. Escalate to approver.
│   └── No eoffice_file_id → Internal workflow issue
│       → Check workflow-service for the tender approval instance
│       → curl -s http://workflow:3029/v1/workflow/instances?refType=tender_award&refId={tenderId}
│       ├── Instance not found → Workflow creation failed. Check outbox.
│       └── Instance stuck → Check workflow-service runbook
├── Is the procurement consumer alive?
│   → curl -s http://procurement:3008/ops/consumer-status | jq '.'
│   ├── Stale → Restart worker
│   └── Healthy → Check specific tender state machine
└── Was the evaluation completed correctly?
    → Tender must be in 'evaluated' state before award
    → Check: psql civitas_procurement -c "SELECT status FROM procurement.tender_evaluations
       WHERE tender_id = '{tenderId}';"
```

**Commands:**

```bash
# Find stuck tenders
psql civitas_procurement -c "
  SELECT id, tender_number, status, updated_at, NOW() - updated_at as stuck_duration
  FROM procurement.tenders
  WHERE status IN ('pending_award_approval', 'evaluated')
  AND updated_at < NOW() - INTERVAL '1 hour'
  ORDER BY updated_at;
"

# Check workflow instance for tender
curl -s "http://workflow:3029/v1/workflow/instances?refType=tender_award&status=active" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {id, refId, currentStep, stuckSince: .updatedAt}'

# Check eOffice decision callback DLQ
curl -s http://procurement:3008/ops/dlq/peek?topic=estab.file.decision&limit=5 | jq .

# Redrive eOffice callbacks (safe — idempotent)
curl -X POST http://procurement:3008/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "estab.file.decision", "batchSize": 10}'

# Check outbox for pending tender events
psql civitas_procurement -c "
  SELECT id, topic, created_at, error FROM procurement.outbox
  WHERE topic LIKE '%tender%' AND relayed_at IS NULL
  ORDER BY created_at LIMIT 10;
"
```

**Verification after fix:**

```bash
# Tender moved past pending_award_approval
psql civitas_procurement -c "
  SELECT id, status, updated_at FROM procurement.tenders
  WHERE id = '{tenderId}';
"

# No more stuck tenders
psql civitas_procurement -c "
  SELECT COUNT(*) FROM procurement.tenders
  WHERE status = 'pending_award_approval'
  AND updated_at < NOW() - INTERVAL '1 hour';
"
```

**Communication template:**

> 🟠 **[P1] Procurement — Tender award approval stuck**  
> {N} tenders stuck in pending_award_approval for > 1 hour. Root cause: {eOffice callback missing | workflow stuck | outbox relay down}.  
> No data loss — tender integrity preserved. Award will proceed on fix.  
> ETR: {10 min for DLQ redrive | 30 min for workflow investigation}.

---

### FM-02: GRN acceptance not propagating downstream (stock/asset/finance blocked)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 15 min |
| **Alert** | `procurement_grn_event_delivery_failed` OR downstream reports GRN not received |
| **Impact** | Stock not updated, assets not registered, 3-way matching blocked — vendor payments delayed |

**Triage:**

```
GRN acceptance not propagating
├── Was the GRN accepted in procurement?
│   → psql civitas_procurement -c "SELECT id, po_id, status, accepted_at
│      FROM procurement.grn WHERE id = '{grnId}';"
│   ├── status = 'accepted' → Event should have been published
│   │   → Check outbox: psql -c "SELECT id, topic, relayed_at, error FROM procurement.outbox
│   │      WHERE topic = 'procurement.grn.accepted' AND payload::text LIKE '%{grnId}%'
│   │      ORDER BY created_at DESC LIMIT 1;"
│   │   ├── relayed_at IS NULL → Outbox relay stuck
│   │   │   → curl -s http://procurement:3008/ops/outbox-relay | jq '.pendingCount'
│   │   │   → Restart: curl -X POST http://procurement:3008/ops/outbox-relay/restart
│   │   ├── relayed_at set → Event was published. Issue is downstream.
│   │   │   → Check stock-service: curl -s http://stock:3011/ops/consumer-status
│   │   │   → Check asset-service: curl -s http://asset:3015/ops/consumer-status
│   │   │   → Check finance-service: curl -s http://finance:3007/ops/consumer-status
│   │   └── error field → Relay failed. Check error type.
│   └── status != 'accepted' → GRN not accepted yet
│       → Check GRN acceptance command in DLQ
│       → May be quality inspection pending
├── Is this affecting one GRN or all?
│   ├── Single GRN → Specific data issue (PO mismatch, qty variance)
│   └── All GRNs → Systemic issue (outbox relay, queue)
└── Is the 3-way match failing?
    → GRN qty vs PO qty vs Invoice qty must match
    → If variance > threshold → Manual approval needed (not a bug)
```

**Commands:**

```bash
# Check GRN status
psql civitas_procurement -c "
  SELECT g.id, g.po_id, g.status, g.accepted_at, g.accepted_qty, p.ordered_qty
  FROM procurement.grn g
  JOIN procurement.purchase_orders p ON p.id = g.po_id
  WHERE g.id = '{grnId}';
"

# Check outbox for GRN events
psql civitas_procurement -c "
  SELECT id, topic, created_at, relayed_at, error FROM procurement.outbox
  WHERE topic = 'procurement.grn.accepted'
  ORDER BY created_at DESC LIMIT 10;
"

# Check outbox relay
curl -s http://procurement:3008/ops/outbox-relay | jq .

# Restart outbox relay
curl -X POST http://procurement:3008/ops/outbox-relay/restart

# Check downstream consumers
curl -s http://stock:3011/ops/consumer-status | jq '.consumers["procurement.grn.accepted"]'
curl -s http://asset:3015/ops/consumer-status | jq '.consumers["procurement.grn.accepted"]'

# Replay pending outbox
curl -X POST http://procurement:3008/ops/outbox-relay/replay-pending
```

**Verification after fix:**

```bash
# Outbox drained
curl -s http://procurement:3008/ops/outbox-relay | jq '.pendingCount == 0'

# Stock-service received GRN
curl -s "http://stock:3011/v1/stock/receipts?grnId={grnId}" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'

# 3-way match progressing
curl -s "http://finance:3007/v1/finance/matching?poId={poId}" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.matchStatus'
```

**Communication template:**

> 🟠 **[P1] Procurement — GRN acceptance events not propagating**  
> {N} GRN acceptances not reaching stock/asset/finance. Vendor payments delayed.  
> Root cause: {outbox relay stuck | queue connectivity | downstream consumer dead}.  
> GRN data intact. Events will propagate on fix.  
> ETR: {5 min for outbox restart | coordinate with downstream for consumer issues}.

---

### FM-03: GeM integration failing (circuit breaker open)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | Monitor (circuit breaker handles) |
| **Alert** | `procurement_circuit_breaker_state{service="gem"} == "open"` |
| **Impact** | GeM item catalog sync and ordering offline — manual procurement continues |

**Triage:**

```
GeM circuit breaker open
├── Check GeM portal availability
│   → curl -s http://procurement:3008/ops/circuit-breakers | jq '.gem'
│   ├── state: "open" → GeM API unreachable
│   │   → GeM portal maintenance is common (weekends, evenings)
│   │   → Check: https://gem.gov.in (portal status)
│   │   → This is auto-recovering. Monitor.
│   └── state: "half-open" → Testing recovery
│       → Wait for next probe. Will auto-close on success.
├── Has GeM API key expired?
│   → docker exec civitasone-procurement env | grep GEM_API_KEY | sed 's/=.*/=***/'
│   → If key rotation was recent, verify new key works
├── Is this blocking procurement?
│   → GeM integration is optional (manual procurement continues)
│   → Items already synced to local catalog remain available
│   → New items from GeM won't appear until sync resumes
└── Was there a GeM API version change?
    → Check response body for version mismatch errors
    → docker logs civitasone-procurement --since=30m | grep "gem\|GeM" | grep -i error
```

**Commands:**

```bash
# Check GeM circuit breaker state
curl -s http://procurement:3008/ops/circuit-breakers | jq '.gem'

# Check GeM-related errors in logs
docker logs civitasone-procurement --since=30m 2>&1 | grep -i "gem" | grep -iE "error|fail|timeout" | tail -10

# Check last successful GeM sync
psql civitas_procurement -c "
  SELECT sync_type, status, completed_at, items_synced
  FROM procurement.gem_sync_log
  ORDER BY completed_at DESC LIMIT 5;
"

# Force half-open (only if GeM confirmed back)
curl -X POST http://procurement:3008/ops/circuit-breakers/gem/half-open

# Check GeM credentials
docker exec civitasone-procurement env | grep -E "GEM_" | sed 's/=.*/=***/'

# Monitor auto-recovery
watch -n10 'curl -s http://procurement:3008/ops/circuit-breakers | jq .gem.state'
```

**Verification after fix:**

```bash
# Circuit breaker closed
curl -s http://procurement:3008/ops/circuit-breakers | jq '.gem.state == "closed"'

# Sync completing
psql civitas_procurement -c "
  SELECT status, completed_at FROM procurement.gem_sync_log
  ORDER BY completed_at DESC LIMIT 1;
"
```

**Communication template:**

> 🟡 **[P2] Procurement — GeM integration offline**  
> Circuit breaker open for GeM API. Root cause: {portal down | API key expired | version change}.  
> Manual procurement unaffected. GeM catalog items retain last-synced state.  
> Auto-recovery monitoring active. ETR: dependent on GeM portal.

---

### FM-04: DLQ on EMD/PBG (financial guarantees at risk)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `procurement_dlq_depth{topic=~"procurement.emd.*|procurement.pbg.*"} > 0` |
| **Impact** | Earnest money deposits or performance bank guarantees not processing — vendor financial integrity at risk |

**Triage:**

```
DLQ on EMD/PBG
├── Read error from DLQ
│   → curl -s http://procurement:3008/ops/dlq/peek?topic=procurement.emd.submit&limit=5 | jq '.[].error'
│   ├── "TENDER_NOT_FOUND" → EMD for non-existent tender
│   │   → Check if tender was cancelled after EMD was submitted
│   │   → Safe to acknowledge — refund process handles this
│   ├── "VENDOR_NOT_REGISTERED" → Vendor submitted EMD without registration
│   │   → Check vendor registration status
│   │   → If registration pending: hold for registration to complete
│   ├── "AMOUNT_MISMATCH" → EMD amount doesn't match tender requirement
│   │   → Validation error. EMD must be corrected.
│   ├── "BANK_GUARANTEE_EXPIRED" → PBG document past validity date
│   │   → Vendor must submit fresh guarantee
│   └── "DB_ERROR" → Transient. Check DB health.
├── Are EMD refunds affected?
│   → EMD must be refunded to unsuccessful bidders after award
│   → If DLQ blocks refund: financial liability
│   → Check: curl -s http://procurement:3008/ops/dlq/peek?topic=procurement.emd.refund
└── Is PBG expiry monitoring working?
    → PBGs have validity periods. Expired PBGs = performance risk.
    → Check sweep: curl -s http://procurement:3008/ops/heartbeat | jq '.scheduledJobs.pbgExpiry'
```

**Commands:**

```bash
# Peek EMD DLQ
curl -s http://procurement:3008/ops/dlq/peek?topic=procurement.emd.submit&limit=5 | jq .

# Peek PBG DLQ
curl -s http://procurement:3008/ops/dlq/peek?topic=procurement.pbg.submit&limit=5 | jq .

# Check EMD refund DLQ (financial liability)
curl -s http://procurement:3008/ops/dlq/peek?topic=procurement.emd.refund&limit=5 | jq .

# Check PBG expiry sweep
curl -s http://procurement:3008/ops/heartbeat | jq '.scheduledJobs.pbgExpiry'

# Check pending EMD refunds
psql civitas_procurement -c "
  SELECT id, tender_id, vendor_id, amount_minor, status
  FROM procurement.emd
  WHERE status = 'pending_refund'
  ORDER BY created_at LIMIT 10;
"

# Redrive (only for transient errors)
curl -X POST http://procurement:3008/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "procurement.emd.submit", "batchSize": 5}'
```

**Verification after fix:**

```bash
# DLQ empty
curl -s http://procurement:3008/ops/dlq | jq '.topics[] | select(.topic | test("emd|pbg"))'

# EMD processing normally
curl -s http://procurement:3008/ops/metrics | grep procurement_emd_processed_total
```

**Communication template:**

> 🟠 **[P1] Procurement — EMD/PBG processing halted**  
> DLQ depth: {N} on {topic}. Root cause: {tender cancelled | vendor unregistered | DB error}.  
> Vendor financial guarantees not processing. Refund liability: check pending refunds.  
> ETR: {5 min for transient | manual resolution for business errors}.

---

### FM-05: Consumer stalled (procurement-worker)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `procurement_worker_heartbeat_stale > 60s` |
| **Impact** | ALL procurement commands stop — tenders, POs, GRN, EMD/PBG, vendor operations |

**Commands:**

```bash
# Check worker heartbeat
curl -s http://procurement:3008/ops/heartbeat | jq .

# View error logs
docker logs civitasone-procurement-worker --tail=100 --since=5m 2>&1 | grep -E "ERROR|FATAL|OOM"

# Restart worker
docker restart civitasone-procurement-worker

# Verify recovery
sleep 5 && curl -s http://procurement:3008/ops/heartbeat | jq '.ageSeconds < 10'

# Check DLQ for poison message that caused crash
curl -s http://procurement:3008/ops/dlq | jq '.topics[] | select(.depth > 0)'

# Verify critical consumers reconnected
curl -s http://procurement:3008/ops/consumer-status | jq '.consumers | keys'
```

**Communication template:**

> 🟠 **[P1] Procurement worker stalled — ALL procurement operations halted**  
> Tenders, POs, GRN, EMD/PBG, vendor operations all paused.  
> Root cause: {OOM | poison message | DB connection exhaustion}.  
> Worker restarted. Queued commands will process.  
> ETR: {5 min for restart + catch-up}.

---

## Rollback

```bash
# Docker
docker pull civitasone/procurement-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d procurement-service procurement-worker

# K8s
kubectl set image deployment/procurement-service \
  procurement=civitasone/procurement-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/procurement-worker \
  worker=civitasone/procurement-service:$PREVIOUS_TAG -n civitasone

# Verify health
curl -s http://procurement:3008/health | jq .

# Verify consumers reconnected
curl -s http://procurement:3008/ops/consumer-status | jq '.consumers | keys'

# Verify GeM circuit breaker state
curl -s http://procurement:3008/ops/circuit-breakers | jq '.gem'

# Verify PBG expiry sweep is active
curl -s http://procurement:3008/ops/heartbeat | jq '.scheduledJobs.pbgExpiry'
```

**CRITICAL:** Tender records are legally binding after publication. Published tenders cannot be un-published (only cancelled with documented reason). EMD amounts are financial — never delete, only refund. PO numbers are sequential — gaps acceptable but duplicates are not.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh procurement --target-time="2026-07-26T02:00:00Z"

# 2. Verify tender integrity (no tenders stuck mid-transition)
psql civitas_procurement -c "
  SELECT id, tender_number, status, updated_at
  FROM procurement.tenders
  WHERE status IN ('pending_award_approval', 'pending_publication')
  ORDER BY updated_at;
"

# 3. Verify PO sequence numbers (no duplicates)
psql civitas_procurement -c "
  SELECT po_number, COUNT(*) FROM procurement.purchase_orders
  GROUP BY po_number HAVING COUNT(*) > 1;
"

# 4. Check EMD/PBG financial integrity
psql civitas_procurement -c "
  SELECT status, COUNT(*), SUM(amount_minor) / 100.0 as total_rupees
  FROM procurement.emd
  GROUP BY status;
"

# 5. Verify GRN events were propagated
psql civitas_procurement -c "
  SELECT id, status, accepted_at FROM procurement.grn
  WHERE accepted_at > '2026-07-26T01:45:00Z';
"

# 6. Replay outbox
curl -X POST http://procurement:3008/ops/outbox-relay/replay-pending

# 7. Re-trigger PBG expiry sweep
curl -X POST http://procurement:3008/ops/pbg-expiry-sweep-now
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Procurement service restored**  
> DB restored to {timestamp}. Tender integrity verified.  
> PO sequence: no duplicates. EMD/PBG financial reconciled.  
> GRN events during gap replayed to downstream services.  
> PBG expiry sweep re-triggered. Audit trail continuous.
