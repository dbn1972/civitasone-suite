# CivitasOne Queue/Event Integration Audit

**Date:** 2025-01-XX  
**Scope:** All 33 services, @civitasone/queue package, cross-service integration tests  
**Auditor:** Architecture Review

---

## Executive Summary

The CivitasOne event-driven architecture is **well-structured** with consistent patterns across services. All 33 services follow CQRS with transactional outbox, all consumers implement idempotency via `markProcessed`, and the queue infrastructure (bus.ts) provides comprehensive DLQ + retry at both the SQS broker level and the application level. However, there are **critical gaps** in cross-service event wiring (2 dead subscribers in analytics, 1 topic mismatch in notifications) and **21 services lack application-level DLQ handling** beyond the infrastructure default.

---

## Metrics Overview

| Metric | Count |
|--------|-------|
| Total unique topics (COMMANDS + EVENTS) defined in topics.ts | **616** |
| Unique COMMAND topics (write-path) | **389** |
| Unique EVENT topics (published via outbox) | **208** |
| Cross-service subscriptions (CONSUMED_EVENTS/CONSUMED/CONSUMES/INBOUND) | **37** |
| Consumer files (subscriber handlers) | **132** |
| Worker entrypoints | **31** (all except gateway-service, queue-service) |

---

## 1. Orphan Publications (Published Events with No Cross-Service Subscriber)

**190 events** are emitted via the transactional outbox but have no cross-service subscriber registered in any other service's `CONSUMED_EVENTS`.

**Assessment:** Most of these are **by design** — they are domain events emitted for the audit trail (all go to `audit.event.record`) and for future extensibility. They follow the architecture's "emit everything, subscribe selectively" philosophy. The audit-service subscribes to `audit.event.record` which every consumer publishes alongside the domain event.

### Notable orphan events that SHOULD have subscribers:

| Event | Service | Gap |
|-------|---------|-----|
| `workflow.task.completed` | workflow-service | No analytics or notification subscriber — task completions are invisible to dashboards |
| `workflow.instance.created` | workflow-service | Same gap — new workflow instances not tracked by analytics |
| `finance.sanction.approved` | finance-service | No procurement/project subscriber reacts to approved sanctions |
| `procurement.tender.required` | procurement-service | No notification triggers for tender requirements |
| `billing.subscription.expired` | billing-service | No admin/notification subscriber — tenant could lose access silently |
| `billing.dunning.exhausted` | billing-service | Critical: no downstream action when payment collection fails permanently |
| `inventory.stock.low` | inventory-service | No procurement/notification subscriber for reorder triggers |
| `identity.user.deactivated` | identity-service | No session revocation or downstream cleanup triggered |
| `identity.session.revoked_all` | identity-service | No cache invalidation across dependent services |

---

## 2. Dead Subscribers (Subscribed but Never Published)

### CRITICAL — True Dead Subscribers

| Topic | Subscriber | Problem |
|-------|-----------|---------|
| `finance.payment.released` | analytics-service (INBOUND) | **Never emitted** — finance-service emits `finance.payment.made` not `released`. Analytics fact ingestion for payment events is broken. |
| `grants.release.processed` | analytics-service (INBOUND) | **Never emitted** by any service. Analytics fact ingestion for grant releases is broken. |
| `notification.alert.send` | (none — published but never consumed) | admin-service and billing-service publish to this topic, but notification-service subscribes to `notification.send`. **Messages silently dropped.** |

### Structurally Dead but Gated by SDK

| Topic | Status |
|-------|--------|
| `hrms.leave_special.file_decided` | Emitted by estab-service callback but NO consumer exists in hrms-service |
| `hrms.recruitment.file_decided` | Emitted by estab-service callback but NO consumer exists in hrms-service |
| `grant.scheme.file_decided` | Emitted by estab-service callback but NO consumer exists in grant-service |
| `procurement.award.file_decided` | Emitted by estab-service callback but NO consumer exists in procurement-service |

**Mitigated:** The eOffice SDK's `DECISION_CONSUMED_REF_TYPES` set excludes these, so the raise path rejects them (fail-closed). No silent data loss occurs, but the approval workflow for these entities is incomplete.

### Legitimate Cross-Service Subscriptions (confirmed active)

All other CONSUMED_EVENTS/CONSUMED/CONSUMES entries are **verified active** — their publishers emit the correct topic string via DISPATCH, MODULE_CALLBACK_TOPICS, or standard EVENTS:
- `tenant.tenant.created` → emitted by tenant-service, consumed by hrms + workflow
- `procurement.grn.accepted` → emitted by procurement-service, consumed by finance + stock + inventory + asset
- `finance.payment.made` → emitted by finance-service, consumed by grant + payroll
- All `*.file_decided` topics in `DECISION_CONSUMED_REF_TYPES` → emitted by estab-service linkage consumer
- `crm.case.opened` → emitted by crm-service, consumed by helpdesk-service
- `telephony.call.missed` → emitted by telephony-service, consumed by helpdesk-service

---

## 3. Dead-Letter Queue (DLQ) Handling

### Infrastructure-Level (All Services)

The `SqsQueue` in `queue-service/src/bus.ts` provides **universal DLQ handling** for all services:

- **SQS RedrivePolicy:** Every per-service queue gets a `-dlq` companion queue with `maxReceiveCount: 5` (configurable via `SQS_MAX_RECEIVE_COUNT`)
- **Application safety net:** If the broker's native DLQ hasn't kicked in, the poll loop dead-letters after `maxReceiveCount` attempts
- **NonRetryableError:** Handlers can throw this to bypass retry and dead-letter immediately
- **Invalid envelope detection:** Unparseable/invalid messages are dead-lettered without invoking handlers
- **Observability:** `incrementDlqMessage()` metric + structured error log on every dead-letter

### Application-Level DLQ (Service-Specific)

Only **12 of 33 services** have application-level DLQ handling beyond the infrastructure default:

| Service | Mechanism |
|---------|-----------|
| workflow-service | Full DLQ subsystem: `subscribeWithDlq()` wrapper, per-message attempt counter in Postgres, admin list/requeue API |
| admin-service | NonRetryableError for permanent failures |
| asset-service | NonRetryableError for permanent failures |
| estab-service | NonRetryableError for permanent failures |
| finance-service | NonRetryableError for permanent failures |
| identity-service | NonRetryableError for permanent failures |
| inventory-service | NonRetryableError for permanent failures |
| notification-service | NonRetryableError for permanent failures |
| payroll-service | NonRetryableError for permanent failures |
| procurement-service | NonRetryableError for permanent failures |
| telephony-service | NonRetryableError for permanent failures |
| queue-service | Infrastructure implementation |

### Services WITHOUT Application-Level DLQ Handling (21)

These rely solely on the SQS infrastructure DLQ. No admin visibility or requeue capability for poisoned messages:

analytics-service, audit-service, billing-service, citizen-service, contract-service, crm-service, gateway-service, grant-service, helpdesk-service, hrms-service, install-service, knowledge-service, legal-service, location-service, plugin-service, policy-service, project-service, report-service, stock-service, tenant-service, theme-service

**Risk:** Dead-lettered messages in these services are invisible to ops until someone checks the SQS DLQ directly. No self-service admin requeue path exists.

---

## 4. Retry Patterns

### Infrastructure Retry (All Services)

- **MemoryQueue:** Exponential backoff (`2^attempt * 10ms`), max 5 attempts
- **SqsQueue:** Visibility timeout redelivery (default 60s), maxReceiveCount 5
- **FIFO queues:** Topic names ending with `.fifo` get FIFO queue semantics with deduplication

### Application Retry (Selective)

- **workflow-service:** `subscribeWithDlq` with configurable `WORKFLOW_DLQ_MAX_ATTEMPTS` (default 5)
- **grant-service:** `canRetryDisbursement()` — domain-aware retry for failed PFMS disbursements
- **billing-service:** `billing.dunning.retry` — explicit retry command for failed payment collection

### Gap: No Circuit Breaker on Queue Consumers

While `@civitasone/circuit-breaker` exists as a package, **no consumer uses it**. A downstream dependency failure (e.g., Postgres down) causes all messages to exhaust retries and dead-letter, rather than pausing consumption.

---

## 5. Idempotency

**Status: ✅ ALL consumers implement idempotency**

Every consumer file (132 total) calls `markProcessed(tx, msg.messageId)` inside the transaction BEFORE writing. The pattern is consistent:

```typescript
await db.transaction(async (tx) => {
  if (!(await markProcessed(tx, msg.messageId))) return; // dedup
  // ... write logic ...
  await enqueue(tx, { topic: EVENTS.*, ... }); // outbox
});
```

The transactional outbox (`shared/outbox.ts`) ensures atomicity: the write + event emit happen in one transaction. The outbox relay then publishes the event.

---

## 6. Queue Integration Tests

### Existing Coverage

22 integration test files in `tests/integration/`:

| Test | Chain Verified |
|------|---------------|
| `finance-chains` | finance integration consumer reacts to payroll/procurement/audit events |
| `payroll-chains` | payroll integration consumer reacts to hrms events |
| `procurement-asset-chains` | asset register consumer reacts to procurement GRN |
| `procurement-stock-chains` | stock entry consumer reacts to procurement GRN |
| `project-grant-chains` | grant integration consumer reacts to project milestone |
| `cross-domain-chains` | multi-hop: hrms → finance → grant |
| `citizen-escalation-chains` | citizen grievance escalation chain |
| `crm-helpdesk-chains` | crm.case.opened → helpdesk ticket |
| `helpdesk-chains` | telephony.call.missed → helpdesk ticket |
| `admin-config-chains` | admin config consumer |
| `asset-depreciation-chains` | asset depreciation run chain |
| `workflow-sla-chains` | workflow SLA sweeper chain |
| `cross-process.localstack` | Real SQS delivery proof (LocalStack-gated) |
| `failure-paths` | DLQ + retry + dedup negative paths |
| `concurrent-writes` | Race condition handling |
| `plugin-theme-chains` | Plugin + theme lifecycle |

### Missing Integration Test Coverage

The following cross-service event chains have **NO integration test**:

| Missing Chain | Risk |
|---------------|------|
| `tenant.tenant.created` → hrms-service + workflow-service provisioning | High — tenant onboarding could break silently |
| `tenant.tenant.isolation_changed` → install-service | Medium |
| `estab.file.approve/reject` → estab-service (from workflow DISPATCH) | High — eOffice approval loop untested end-to-end |
| `*.file_decided` → source service eoffice-consumers | High — entire approval backbone untested as a chain |
| `citizen.rti.filed` → estab-service | Medium |
| `estab.rti.responded` → citizen-service | Medium |
| `legal.contract_review.cleared` → procurement-service | Medium |
| `billing.*` chains (subscription, dunning, payments) | Medium — monetization flow |
| `audit.event.record` → audit-service ingestion | Low (simple pipe) |
| `notification.send` → notification-service delivery | Medium |
| analytics INBOUND events (finance/grants/procurement) | **Critical — known broken (see dead subscribers)** |
| `inventory.stock.low` → (no downstream chain exists) | Medium |

---

## 7. Critical Event-Flow Gaps

### 🔴 CRITICAL — Data Loss / Silent Failures

1. **Analytics Inbound Broken:** `finance.payment.released` and `grants.release.processed` are subscribed to by analytics-service but never emitted by any service. Analytics fact tables for financial and grant data are empty.

2. **Notification Topic Mismatch:** admin-service and billing-service publish to `notification.alert.send` but notification-service subscribes to `notification.send`. Admin support notifications and billing invoice notifications are silently dropped (messages enter the SQS queue but no consumer polls them — they'll eventually dead-letter).

3. **No Session Invalidation Chain:** `identity.user.deactivated` and `identity.session.revoked_all` have no cross-service subscribers. A deactivated user's active sessions in other services may remain valid until JWT expiry.

### 🟡 HIGH — Incomplete Business Flows

4. **eOffice Callback Gaps:** 4 source ref types (`hr_leave_special`, `hr_recruitment`, `grant_scheme`, `procurement_award`) have callback topics defined but no consumer. The SDK fail-closes these, but approval workflows for these entities cannot use eOffice.

5. **Stock Reorder Not Triggered:** `inventory.stock.low` is emitted but no procurement or notification consumer reacts. Reorder workflows require manual monitoring.

6. **Billing Dunning Dead-End:** `billing.dunning.exhausted` is emitted but nothing acts on it — no suspension, no admin alert, no tenant degradation.

7. **Subscription Expiry Ignored:** `billing.subscription.expired` has no downstream consumer to enforce access restrictions.

### 🟡 HIGH — Operational Gaps

8. **21 Services Lack DLQ Visibility:** No admin API or structured alerting for dead-lettered messages outside workflow-service. Ops teams must manually inspect SQS DLQs.

9. **No Consumer Circuit Breaker:** Database/dependency failures cause message exhaustion rather than graceful backpressure.

10. **Fan-out Discovery Latency:** `SqsQueue.resolveSubscriberQueues()` caches for 15s. A newly deployed service won't receive messages for up to 15s after boot. Not a bug, but important for canary deploys.

### 🟢 MEDIUM — Design Gaps

11. **`admin.tenant.created` vs `tenant.tenant.created`:** admin-service emits its own `admin.tenant.created` event which nobody subscribes to. All tenant-creation consumers subscribe to `tenant.tenant.created` from tenant-service. This is redundant but not broken.

12. **Workflow Events Unobserved:** `workflow.task.completed`, `workflow.instance.created`, `workflow.instance.cancelled` — no analytics or reporting subscriber. Workflow metrics require direct DB queries.

---

## 8. Architecture Strengths

- **Consistent CQRS:** Every service follows route → validate → publish → 202. Consumers handle writes.
- **Universal Idempotency:** 132/132 consumers use `markProcessed` — no duplicate processing.
- **Transactional Outbox:** All event emissions are atomic with the DB write.
- **Fan-out Architecture:** `SqsQueue` implements SNS-style fan-out without SNS — each subscribing service gets its own queue per topic. Multi-subscriber events (e.g., `procurement.grn.accepted` → 4 services) work correctly.
- **Envelope Validation:** Invalid messages are caught at the bus level before reaching handlers.
- **Structured Observability:** Error metrics + structured logs for every consumer failure.
- **NonRetryableError:** Permanent domain failures skip retry (used in 10 services).

---

## Recommendations

### Immediate (P0)

1. **Fix analytics INBOUND topics:** Either emit `finance.payment.released` / `grants.release.processed` from the correct consumers, or update analytics INBOUND to subscribe to `finance.payment.made` / `grant.disbursement.completed`.
2. **Fix notification topic mismatch:** Change admin-service and billing-service from `"notification.alert.send"` to `"notification.send"` (or `COMMANDS.sendNotification` from notification-service topics).
3. **Add session invalidation subscriber:** notification-service or a new cache-invalidation consumer should react to `identity.user.deactivated`.

### Short-Term (P1)

4. Add integration tests for the eOffice approval backbone (file_decided chain).
5. Add integration test for tenant provisioning chain.
6. Implement `billing.subscription.expired` → admin-service enforcement consumer.
7. Implement `inventory.stock.low` → notification-service alert.
8. Add DLQ admin API (similar to workflow-service's) as a shared package or per-service middleware.

### Medium-Term (P2)

9. Implement circuit-breaker on consumer poll loops (pause polling when dependency is down).
10. Add `workflow.task.completed` → analytics-service INBOUND for workflow metrics.
11. Build consumers for the 4 remaining eOffice callback types.
12. Add contract tests verifying topic string compatibility across producer/consumer boundaries.
