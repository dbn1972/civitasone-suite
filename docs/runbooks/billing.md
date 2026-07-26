# Runbook: billing-service

> **Tier 2** | SLO: 99.9% availability, payment processing p95 < 3s, DLQ = 0  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Platform/Revenue Domain Owner | **Escalation:** SRE → CTO  
> **Slack:** `#incident-billing` | **PagerDuty:** `billing-critical`  

---

## Purpose

Subscription billing platform powering plans, subscriptions, invoices, payments, checkout, dunning, e-invoicing (NIC GST), revenue recognition, usage metering, churn prediction, payment gateway integration (Razorpay), GSTN compliance, and proration logic. Owns `civitas_billing` on port 3023. If billing is down, no new subscriptions activate, invoices stop generating, payment collection halts, and dunning workflows freeze.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_billing`) | `curl -s http://billing:3023/ready \| jq .checks.db` | Total outage — all billing operations halt |
| Redis | `curl -s http://billing:3023/ready \| jq .checks.cache` | Degraded reads (fallthrough to DB) |
| SQS/RabbitMQ | `curl -s http://billing:3023/ready \| jq .checks.queue` | Invoice generation, payment processing stop |
| Razorpay | `curl -s http://billing:3023/ops/circuit-breakers \| jq .razorpay` | Payment collection offline (queued safely) |
| NIC e-Invoice Portal | `curl -s http://billing:3023/ops/circuit-breakers \| jq .einvoice` | e-Invoice generation paused (queued) |
| ml-service (churn prediction) | `curl -s http://ml:3032/ready` | Churn risk scoring unavailable (graceful degrade) |

**Cross-service consumed:** `ml.prediction.churn_risk_high`

**Cross-service produced:** `billing.subscription.activated`, `billing.invoice.generated`, `billing.payment.received`, `billing.dunning.exhausted`, `billing.churn.detected`

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Billing Overview | `https://grafana.internal/d/billing-overview` | p95 latency, error rate, throughput, active subscriptions |
| DLQ Monitor | `https://grafana.internal/d/billing-dlq` | DLQ depth by topic, age of oldest message |
| Razorpay Integration | `https://grafana.internal/d/billing-razorpay` | Webhook success rate, circuit breaker state, payment volume |
| Revenue & Invoicing | `https://grafana.internal/d/billing-revenue` | MRR, invoice generation rate, dunning funnel |
| e-Invoice Status | `https://grafana.internal/d/billing-einvoice` | NIC API success rate, IRN generation, failures |

---

## Failure Modes

### FM-01: Razorpay webhook not processing

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `billing_razorpay_webhook_failures > 5` in 5 min |
| **Impact** | Payment confirmations not received — subscriptions stay in pending, invoices not marked paid |

**Triage:**

```
Razorpay webhooks failing
├── Are webhooks arriving at all?
│   → Check: docker logs civitasone-billing --since=5m 2>&1 | grep "razorpay.*webhook"
│   ├── No webhook entries → Razorpay not sending
│   │   → Check Razorpay dashboard: https://dashboard.razorpay.com/app/webhooks
│   │   → Verify webhook URL is correct and publicly reachable
│   │   → Verify RAZORPAY_WEBHOOK_SECRET matches Razorpay config
│   └── Webhook entries present → Signature verification or processing failure
│       → Check: grep "signature.*invalid" in logs
│       ├── Signature mismatch → RAZORPAY_WEBHOOK_SECRET rotated without updating env
│       │   → FIX: Update RAZORPAY_WEBHOOK_SECRET from Razorpay dashboard
│       │   → Restart service after env update
│       └── Signature valid but processing fails
│           → Check DB connectivity (ready endpoint)
│           → Check for DLQ messages on billing.payment.* topics
│           → Likely: schema validation error on new Razorpay payload field
│           → FIX: Check payload against zod schema, add missing optional fields
├── Is the X-Razorpay-Signature header present?
│   → If missing, Razorpay webhook version may have changed
│   → Verify API version in Razorpay dashboard matches expected
└── Is circuit breaker open?
    → curl -s http://billing:3023/ops/circuit-breakers | jq .razorpay
    → If open, wait for half-open (30s). If stays open, check outbound connectivity.
```

**Commands:**

```bash
# Check webhook processing rate
curl -s http://billing:3023/ops/metrics | grep billing_webhook_processed_total

# Check recent webhook failures in logs
docker logs civitasone-billing --since=10m 2>&1 | grep -i "webhook" | grep -iE "error|fail|invalid" | tail -20

# Verify Razorpay credentials are set
docker exec civitasone-billing env | grep -E "RAZORPAY_KEY_ID|RAZORPAY_WEBHOOK_SECRET" | sed 's/=.*/=***/'

# Manually verify a webhook signature (debug)
# Note: requires the raw request body and X-Razorpay-Signature header
echo -n "$RAW_BODY" | openssl dgst -sha256 -hmac "$RAZORPAY_WEBHOOK_SECRET" | awk '{print $2}'

# Check DLQ for stuck payment events
curl -s http://billing:3023/ops/dlq/peek?topic=billing.payment.confirm&limit=5 | jq .

# Redrive webhook DLQ messages (ONLY after fixing root cause)
curl -X POST http://billing:3023/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "billing.payment.confirm", "batchSize": 10}'
```

**Verification after fix:**

```bash
# Confirm webhook processing resumes
watch -n5 'curl -s http://billing:3023/ops/metrics | grep billing_webhook_processed_total'

# Confirm no new DLQ entries
curl -s http://billing:3023/ops/dlq | jq '.depth == 0'

# Check a recent payment was correctly marked as paid
psql civitas_billing -c "
  SELECT id, status, razorpay_payment_id, updated_at
  FROM billing.payments
  WHERE updated_at > NOW() - INTERVAL '5 minutes'
  ORDER BY updated_at DESC LIMIT 5;
"
```

**Communication template:**

> 🟠 **[P1] Billing — Razorpay webhook processing halted**  
> Payment confirmations not being received. Root cause: {signature mismatch | secret rotation | payload schema change}.  
> No double-charging possible — idempotency keys active. Payments queued safely.  
> ETR: {10 min for secret fix | 30 min for schema update}.

---

### FM-02: DLQ on invoice.generate

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `billing_dlq_depth{topic="billing.invoice.generate"} > 0` |
| **Impact** | Invoices not generated — downstream dunning, revenue recognition, and payment collection blocked |

**Triage:**

```
DLQ on invoice.generate
├── Read error from DLQ message
│   → curl -s http://billing:3023/ops/dlq/peek?topic=billing.invoice.generate&limit=5 | jq '.[].error'
│   ├── "SUBSCRIPTION_NOT_FOUND" / "PLAN_NOT_FOUND"
│   │   → Stale subscription reference. Check if subscription was cancelled mid-cycle.
│   │   → Safe to acknowledge — no invoice needed for cancelled subscription.
│   ├── "PRORATION_CALCULATION_ERROR"
│   │   → Plan change mid-cycle with conflicting proration rules.
│   │   → Check subscription.plan_changes table for conflicting entries.
│   │   → FIX: Resolve conflicting plan change, then redrive.
│   ├── "GSTN_VALIDATION_FAILED"
│   │   → Customer GSTN invalid or not verified.
│   │   → FIX: Update customer GSTN, then redrive.
│   ├── "DB_CONNECTION_ERROR" / "TIMEOUT"
│   │   → Transient. Check DB health first.
│   │   → curl -s http://billing:3023/ready | jq .checks.db
│   │   → If healthy now, safe to redrive batch.
│   └── Unknown error
│       → Escalate to billing domain owner within 10 min.
└── Is the consumer alive?
    → curl -s http://billing:3023/ops/consumer-status | jq '.lastProcessedAt'
    → If stale > 60s, restart worker.
```

**Commands:**

```bash
# Peek at DLQ messages
curl -s http://billing:3023/ops/dlq/peek?topic=billing.invoice.generate&limit=10 | jq '.[] | {id: .messageId, error: .error, subscriptionId: .payload.subscriptionId}'

# Check how many invoices are pending generation
psql civitas_billing -c "
  SELECT COUNT(*) as pending_invoices
  FROM billing.subscriptions
  WHERE status = 'active'
  AND next_invoice_at < NOW()
  AND id NOT IN (SELECT subscription_id FROM billing.invoices WHERE period_start >= date_trunc('month', NOW()));
"

# Redrive after fixing root cause
curl -X POST http://billing:3023/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "billing.invoice.generate", "batchSize": 20}'

# Acknowledge unfixable messages (e.g., cancelled subscriptions)
curl -X POST http://billing:3023/ops/dlq/ack \
  -H "Content-Type: application/json" \
  -d '{"messageIds": ["msg-id-1", "msg-id-2"]}'
```

**Verification after fix:**

```bash
# DLQ empty
curl -s http://billing:3023/ops/dlq | jq '.depth'

# Invoices being generated again
curl -s http://billing:3023/ops/metrics | grep billing_invoices_generated_total

# No gap in invoice sequence
psql civitas_billing -c "
  SELECT invoice_number, created_at FROM billing.invoices
  ORDER BY created_at DESC LIMIT 10;
"
```

**Communication template:**

> 🟠 **[P1] Billing — Invoice generation stalled**  
> DLQ depth: {N} messages on `billing.invoice.generate`. Root cause: {proration error | GSTN invalid | DB timeout}.  
> No revenue loss — invoices will generate on redrive. Dunning paused for affected accounts.  
> ETR: {10 min for transient | 1h for data fix}.

---

### FM-03: Dunning exhausted (payment collection failed permanently)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 1 hour |
| **Alert** | `billing_dunning_exhausted_total` increasing > 10/hour |
| **Impact** | Subscriptions at risk of cancellation — revenue leakage if not addressed |

**Triage:**

```
Dunning exhausted spike
├── Is this a single tenant or platform-wide?
│   → psql civitas_billing -c "SELECT tenant_id, COUNT(*) FROM billing.dunning_runs
│      WHERE status = 'exhausted' AND updated_at > NOW() - INTERVAL '1 hour'
│      GROUP BY tenant_id ORDER BY count DESC;"
│   ├── Single tenant → Likely bulk card expiry or payment method issue
│   │   → Notify tenant admin. Not a system issue.
│   └── Platform-wide → Razorpay integration issue or card network outage
│       → Check Razorpay dashboard for elevated decline rates
│       → Check: curl -s http://billing:3023/ops/circuit-breakers | jq .razorpay
│       ├── Razorpay healthy → Card network issue (Visa/Mastercard outage)
│       │   → Wait and retry. Extend dunning window.
│       └── Razorpay unhealthy → See FM-01
├── Are retry attempts actually being made?
│   → Check dunning schedule execution
│   → curl -s http://billing:3023/ops/metrics | grep billing_dunning_attempt_total
│   ├── Attempts happening but all failing → Payment method issue (external)
│   └── No attempts → Dunning scheduler stuck. Check worker health.
└── Has dunning configuration changed recently?
    → Check if max_attempts or retry_interval was modified
    → psql civitas_billing -c "SELECT * FROM billing.dunning_config ORDER BY updated_at DESC LIMIT 1;"
```

**Commands:**

```bash
# Check dunning exhaustion rate
psql civitas_billing -c "
  SELECT date_trunc('hour', updated_at) as hour, COUNT(*)
  FROM billing.dunning_runs
  WHERE status = 'exhausted' AND updated_at > NOW() - INTERVAL '24 hours'
  GROUP BY hour ORDER BY hour;
"

# Check recent payment decline reasons
psql civitas_billing -c "
  SELECT error_code, COUNT(*) FROM billing.payment_attempts
  WHERE status = 'failed' AND created_at > NOW() - INTERVAL '1 hour'
  GROUP BY error_code ORDER BY count DESC LIMIT 10;
"

# Extend dunning window for affected subscriptions (emergency — prevent mass cancellation)
psql civitas_billing -c "
  UPDATE billing.dunning_runs
  SET max_attempts = max_attempts + 3, status = 'active'
  WHERE status = 'exhausted'
  AND updated_at > NOW() - INTERVAL '2 hours';
"

# Verify churn event was emitted for exhausted dunning
curl -s http://billing:3023/ops/outbox-relay | jq '.pendingCount'
```

**Verification after fix:**

```bash
# Dunning exhaustion rate back to normal
curl -s http://billing:3023/ops/metrics | grep billing_dunning_exhausted_total

# Payment success rate recovering
psql civitas_billing -c "
  SELECT status, COUNT(*) FROM billing.payment_attempts
  WHERE created_at > NOW() - INTERVAL '1 hour'
  GROUP BY status;
"
```

**Communication template:**

> 🟡 **[P2] Billing — Elevated dunning exhaustion rate**  
> {N} subscriptions reached max dunning attempts in last hour. Root cause: {card network outage | Razorpay issue | bulk card expiry}.  
> Affected subscriptions will NOT auto-cancel for {X} hours (grace period extended).  
> ETR: Monitoring. External dependency.

---

### FM-04: e-Invoice generation failing (NIC portal)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `billing_einvoice_failure_rate > 10%` for 5 min |
| **Impact** | GST-compliant e-invoices not generated — compliance risk, cannot share invoice with customer |

**Triage:**

```
e-Invoice failures
├── Check NIC portal connectivity
│   → curl -s http://billing:3023/ops/circuit-breakers | jq .einvoice
│   ├── state: "open" → NIC portal unreachable
│   │   → Common during NIC maintenance windows (usually Sat night)
│   │   → Check: https://einvoice1.gst.gov.in (portal status)
│   │   → Invoices queue safely. Will generate when portal recovers.
│   └── state: "closed" → Portal reachable but returning errors
│       → Check specific error codes in logs
│       → grep "einvoice" logs | grep "error" | tail -10
│       ├── "AUTH_TOKEN_EXPIRED" → EINVOICE_GSTIN credentials need refresh
│       │   → FIX: Refresh auth token via NIC API
│       └── "DUPLICATE_IRN" → Invoice already registered (idempotency)
│           → Safe to acknowledge. Update local record with existing IRN.
├── Has EINVOICE_API_URL or EINVOICE_GSTIN changed?
│   → docker exec civitasone-billing env | grep EINVOICE
│   → Verify GSTIN is valid and registered on NIC portal
└── Is this specific to certain invoice types?
    → Check if B2B invoices fail but B2C succeed (different endpoints)
    → Check if specific GSTN validation is failing
```

**Commands:**

```bash
# Check e-invoice circuit breaker
curl -s http://billing:3023/ops/circuit-breakers | jq '.einvoice'

# Check recent e-invoice failures
psql civitas_billing -c "
  SELECT error_code, COUNT(*), MAX(attempted_at) as last_attempt
  FROM billing.einvoice_attempts
  WHERE status = 'failed' AND attempted_at > NOW() - INTERVAL '1 hour'
  GROUP BY error_code ORDER BY count DESC;
"

# Check pending e-invoices (queue backlog)
psql civitas_billing -c "
  SELECT COUNT(*) as pending FROM billing.invoices
  WHERE einvoice_status = 'pending' AND created_at > NOW() - INTERVAL '24 hours';
"

# Force half-open on circuit breaker (ONLY if NIC portal confirmed back)
curl -X POST http://billing:3023/ops/circuit-breakers/einvoice/half-open

# Retry failed e-invoices
curl -X POST http://billing:3023/ops/einvoice/retry-failed \
  -H "Content-Type: application/json" \
  -d '{"since": "2026-07-26T00:00:00Z", "batchSize": 50}'
```

**Verification after fix:**

```bash
# e-Invoice success rate recovering
curl -s http://billing:3023/ops/metrics | grep billing_einvoice_success_total

# Pending queue draining
watch -n10 'psql civitas_billing -c "SELECT COUNT(*) FROM billing.invoices WHERE einvoice_status = '\''pending'\'';"'
```

**Communication template:**

> 🟡 **[P2] Billing — e-Invoice generation degraded**  
> NIC portal {unreachable | returning errors}. {N} invoices pending IRN generation.  
> Invoices issued to customers without IRN. Will backfill when portal recovers.  
> No revenue impact. Compliance risk: low (72h buffer per GST rules).  
> ETR: Dependent on NIC portal recovery.

---

### FM-05: Subscription stuck in pending_activation

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `billing_subscription_pending_activation_age > 300s` |
| **Impact** | New customers cannot access platform features — onboarding blocked |

**Triage:**

```
Subscription stuck in pending_activation
├── Check if payment was confirmed
│   → psql civitas_billing -c "SELECT s.id, s.status, p.status as payment_status
│      FROM billing.subscriptions s
│      LEFT JOIN billing.payments p ON p.subscription_id = s.id
│      WHERE s.status = 'pending_activation'
│      ORDER BY s.created_at DESC LIMIT 10;"
│   ├── payment_status = 'confirmed' → Activation event not processed
│   │   → Check DLQ for billing.subscription.activate topic
│   │   → Check outbox relay: curl -s http://billing:3023/ops/outbox-relay | jq .
│   │   → FIX: If outbox stuck, restart relay. If DLQ, redrive.
│   ├── payment_status = 'pending' → Razorpay webhook not received (see FM-01)
│   └── payment_status = NULL → Checkout incomplete (not a system issue)
│       → Customer abandoned checkout. No action needed.
├── Is the activation consumer running?
│   → curl -s http://billing:3023/ops/consumer-status | jq '.consumers["billing.subscription.activate"]'
│   ├── Not found → Consumer not registered. Deployment issue.
│   └── Found but stale → Consumer stuck. Restart worker.
└── Is there a plan/entitlement lookup failure?
    → Activation requires plan details + tenant provisioning
    → Check if plan exists: psql civitas_billing -c "SELECT id, status FROM billing.plans WHERE id = '{planId}';"
```

**Commands:**

```bash
# Find stuck subscriptions
psql civitas_billing -c "
  SELECT id, tenant_id, plan_id, status, created_at,
         NOW() - created_at as stuck_duration
  FROM billing.subscriptions
  WHERE status = 'pending_activation'
  AND created_at < NOW() - INTERVAL '5 minutes'
  ORDER BY created_at;
"

# Check activation consumer health
curl -s http://billing:3023/ops/consumer-status | jq '.'

# Check outbox for pending activation events
psql civitas_billing -c "
  SELECT id, topic, created_at, error FROM billing.outbox
  WHERE topic LIKE '%subscription%activate%' AND relayed_at IS NULL
  ORDER BY created_at LIMIT 10;
"

# Manually trigger activation for a stuck subscription (emergency)
curl -X POST http://billing:3023/ops/subscription/force-activate \
  -H "Content-Type: application/json" \
  -d '{"subscriptionId": "{sub-id}"}'

# Restart outbox relay
curl -X POST http://billing:3023/ops/outbox-relay/restart
```

**Verification after fix:**

```bash
# No more stuck subscriptions
psql civitas_billing -c "
  SELECT COUNT(*) FROM billing.subscriptions
  WHERE status = 'pending_activation'
  AND created_at < NOW() - INTERVAL '5 minutes';
"

# Activation events flowing
curl -s http://billing:3023/ops/metrics | grep billing_subscription_activated_total
```

**Communication template:**

> 🟡 **[P2] Billing — Subscription activation delayed**  
> {N} subscriptions stuck in pending_activation for > 5 min. Root cause: {outbox relay stuck | consumer dead | payment webhook missing}.  
> New customer onboarding delayed. No data loss — activation will complete on fix.  
> ETR: {5 min for relay restart | 15 min for webhook fix}.

---

### FM-06: Revenue accrual mismatch

| Field | Value |
|-------|-------|
| **Severity** | P3 |
| **Time to act** | < 4 hours (before EoD reconciliation) |
| **Alert** | `billing_revenue_accrual_drift > 1%` |
| **Impact** | Revenue reports inaccurate — finance team cannot close books accurately |

**Triage:**

```
Revenue accrual mismatch
├── Is it a timing issue (eventual consistency)?
│   → Check if outbox relay is behind
│   → curl -s http://billing:3023/ops/outbox-relay | jq '.pendingCount'
│   ├── pendingCount > 0 → Events still propagating. Wait 5 min and recheck.
│   └── pendingCount == 0 → Genuine mismatch
│       → Run reconciliation report
│       → psql civitas_billing -c "SELECT * FROM billing.revenue_reconciliation_view
│          WHERE period = date_trunc('month', NOW());"
│       ├── Invoice total ≠ revenue recognized
│       │   → Check for invoices with missing recognition entries
│       │   → Likely: proration or plan-change not correctly split across periods
│       └── Payment total ≠ cash received
│           → Check for unmatched Razorpay settlements
│           → Run: billing.settlement_reconciliation job
├── Was there a recent plan/pricing change?
│   → Plan changes mid-period cause proration entries
│   → Verify proration logic for edge cases (upgrade on last day of month)
└── Is usage-based billing involved?
    → Usage meters may report after period close
    → Check usage.meter_readings for late arrivals
```

**Commands:**

```bash
# Run reconciliation check
psql civitas_billing -c "
  SELECT
    SUM(amount_minor) FILTER (WHERE type = 'invoice') as invoiced,
    SUM(amount_minor) FILTER (WHERE type = 'recognized') as recognized,
    SUM(amount_minor) FILTER (WHERE type = 'invoice') - SUM(amount_minor) FILTER (WHERE type = 'recognized') as drift
  FROM billing.revenue_ledger
  WHERE period = date_trunc('month', NOW());
"

# Find unrecognized invoices
psql civitas_billing -c "
  SELECT i.id, i.amount_minor, i.created_at
  FROM billing.invoices i
  LEFT JOIN billing.revenue_entries r ON r.invoice_id = i.id
  WHERE r.id IS NULL AND i.status = 'paid'
  AND i.created_at > date_trunc('month', NOW());
"

# Trigger revenue reconciliation job
curl -X POST http://billing:3023/ops/revenue/reconcile \
  -H "Content-Type: application/json" \
  -d '{"period": "2026-07"}'

# Check proration entries for correctness
psql civitas_billing -c "
  SELECT subscription_id, proration_amount, reason, created_at
  FROM billing.proration_entries
  WHERE created_at > NOW() - INTERVAL '24 hours'
  ORDER BY created_at DESC LIMIT 20;
"
```

**Verification after fix:**

```bash
# Drift back within tolerance (< 0.1%)
psql civitas_billing -c "
  SELECT
    ABS(SUM(amount_minor) FILTER (WHERE type = 'invoice') - SUM(amount_minor) FILTER (WHERE type = 'recognized'))::float
    / NULLIF(SUM(amount_minor) FILTER (WHERE type = 'invoice'), 0) * 100 as drift_pct
  FROM billing.revenue_ledger
  WHERE period = date_trunc('month', NOW());
"
```

**Communication template:**

> 🔵 **[P3] Billing — Revenue accrual drift detected**  
> {X}% drift between invoiced and recognized revenue for current period.  
> Root cause: {proration edge case | late usage meter | missing recognition entry}.  
> Finance team notified. Reconciliation job running. No customer impact.  
> ETR: {30 min for reconciliation job | 4h for manual investigation}.

---

## Rollback

```bash
# Docker
docker pull civitasone/billing-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d billing-service

# K8s
kubectl set image deployment/billing-service \
  billing=civitasone/billing-service:$PREVIOUS_TAG -n civitasone

# Verify health post-rollback
curl -s http://billing:3023/health | jq .

# Verify Razorpay webhook endpoint is responding
curl -s -o /dev/null -w "%{http_code}" http://billing:3023/v1/billing/webhooks/razorpay

# Verify subscription creation flow works
curl -s http://billing:3023/ops/consumer-status | jq '.consumers | keys'
```

**Caution:** Migrations are forward-only. Billing schema changes (especially invoice numbering sequences, revenue ledger entries) require restore-from-backup rather than destructive rollback. Never roll back if new invoices or payments have been recorded on the new schema.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh billing --target-time="2026-07-26T02:00:00Z"

# 2. Verify restore integrity
psql civitas_billing -c "SELECT COUNT(*) FROM billing.invoices WHERE created_at > '2026-07-26T01:45:00Z';"
psql civitas_billing -c "SELECT COUNT(*) FROM billing.payments WHERE created_at > '2026-07-26T01:45:00Z';"

# 3. Replay outbox (idempotent — safe to replay)
curl -X POST http://billing:3023/ops/outbox-relay/replay-pending

# 4. Reconcile with Razorpay (check for payments received during gap)
curl -X POST http://billing:3023/ops/razorpay/reconcile \
  -H "Content-Type: application/json" \
  -d '{"since": "2026-07-26T01:45:00Z"}'

# 5. Verify subscription states are consistent
psql civitas_billing -c "
  SELECT status, COUNT(*) FROM billing.subscriptions
  GROUP BY status ORDER BY count DESC;
"

# 6. Verify invoice sequence continuity (no gaps)
psql civitas_billing -c "
  SELECT invoice_number FROM billing.invoices
  ORDER BY created_at DESC LIMIT 5;
"

# 7. Run revenue reconciliation
curl -X POST http://billing:3023/ops/revenue/reconcile \
  -H "Content-Type: application/json" \
  -d '{"period": "2026-07"}'
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Billing service restored**  
> DB restored to {timestamp}. Outbox replayed. Razorpay reconciled.  
> {N} payments received during gap correctly matched.  
> Invoice sequence: continuous, no gaps. Revenue accrual: balanced.  
> No customer impact — subscriptions active, dunning resumed.
