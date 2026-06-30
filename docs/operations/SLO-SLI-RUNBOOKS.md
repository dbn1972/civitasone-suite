# CivitasOne Suite — SLOs, SLIs & Service Runbooks

**Date:** 2026-06-30
**Owner:** SRE Lead, with per-service owners
**Charter basis:** §28 (NFRs), §38 (SLO/SLI/Service Operations Standard)
**Platform targets (steering):** 1,000 TPS sustained, 10M users.

> Charter §38.6: *a service is not production-ready unless it has SLOs, dashboards, alerts, a runbook, ownership, and failure-testing evidence.* This document establishes that baseline for the critical services and the standard every service must adopt.

---

## 1. Platform-wide SLO targets (Charter §28)

| Indicator | Target | Charter ref |
|-----------|--------|-------------|
| Core service availability | **99.9%** (99.95% enterprise) | §28.1 |
| p95 interactive read latency | **< 300–500 ms** | §28.2 |
| p95 auth/session validation | **< 150 ms** | §28.2 |
| p95 list/search | **< 2 s** | §28.2 |
| RPO (critical data) | **≤ 15 min** | §28.3 |
| RTO (critical systems) | **≤ 4 h** | §28.3 |
| Error budget window | 30-day rolling | §38.3 |

**Write path note:** CivitasOne is CQRS — writes return `202 Accepted` immediately and are processed async. The meaningful write SLI is therefore **command-processing latency** (publish → consumer commit) and **queue lag**, not HTTP write latency.

---

## 2. SLIs available today (no new instrumentation required)

`@civitasone/observability` already exposes these via `registerOpsRoutes` (on all 33 services):

| SLI | Source metric |
|-----|---------------|
| Consumer liveness | `recordConsumerHeartbeat` / `getLastConsumerHeartbeat` / `consumerHeartbeatCheck` |
| Consumer error rate | `getConsumerErrorCount` |
| DLQ depth (poison/failed) | `getDlqMessageCount` |
| Outbox relay failures | `getOutboxRelayFailureCount` |
| Captured errors (by service) | `getCapturedErrorCountByService` |
| **Request latency p50/p95/p99** | `http_request_duration_ms` histogram (per service/method/route) + `getHttpLatencyQuantile()` |
| Gateway upstream readiness | gateway `/ready` (identity, finance, queue) |

**Status:** request-latency histograms are now emitted by `registerOpsRoutes` on every service (PERF-1), and a per-tenant request counter `http_requests_by_tenant_total` (PERF-2, cardinality-capped) supports the noisy-neighbor SLO. Latency and noisy-neighbor alerts are wired in `infra/observability/alert.rules.yml`.

---

## 3. Per-service SLO table (critical services)

| Service | Tier | Availability SLO | Key latency SLI | Async SLI | Error-budget owner |
|---------|------|------------------|-----------------|-----------|--------------------|
| **gateway** | 0 (edge) | 99.95% | p95 proxy < 50 ms overhead | n/a | SRE |
| **identity** | 0 (auth) | 99.95% | p95 token validate < 150 ms | n/a | Security |
| **queue** | 0 (bus) | 99.95% | publish < 100 ms | DLQ depth = 0; lag < 60 s | Platform Arch |
| **finance** | 1 | 99.9% | p95 read < 400 ms | cmd commit < 5 s; DLQ = 0 | Finance owner |
| **estab** (eOffice) | 1 | 99.9% | p95 read < 500 ms | cmd commit < 5 s | Estab owner |
| **workflow** | 1 | 99.9% | p95 read < 400 ms | task dispatch < 10 s | Workflow owner |
| **hrms / payroll** | 1 | 99.9% | p95 read < 500 ms | payroll run within SLA window | HR owner |
| **audit** | 1 | 99.9% | n/a (write-mostly) | event ingest lag < 30 s | Audit owner |
| **citizen** | 2 | 99.5% | p95 read < 800 ms | grievance/RTI SLA sweep on time | Citizen owner |
| (all others) | 2 | 99.5% | p95 read < 800 ms | DLQ = 0 | Service owner |

**Alert thresholds (default):** page at availability burn-rate >2% of 30-day budget in 1 h; warn at DLQ depth ≥1 (Tier 0/1) / ≥10 (Tier 2); page if `consumerHeartbeatCheck` stale > 2× poll window; warn at outbox relay failures > 0 sustained 5 min.

---

## 4. Customer-impact thresholds (Charter §38.5)

| Level | Definition |
|-------|------------|
| Degraded | p95 latency 2× target, or queue lag 60 s–5 min, or single non-critical service erroring |
| Partial outage | One Tier-1 service down, or DLQ filling on a critical topic, or gateway upstream check failing for one dependency |
| Full outage | Gateway down, identity down (no logins), or queue bus down (no writes processed) |
| Tenant-specific incident | Isolation/clearance anomaly, or a single tenant's quota/rate causing degradation |
| Backlog incident | Queue lag > 5 min or DLQ depth growing unbounded on any Tier-0/1 topic |

---

## 5. Standard service runbook template (Charter §38.4)

Every service MUST maintain a runbook with these sections. Below is the **filled template for the critical services**; Tier-2 services copy this and adjust.

### Runbook: `<service>-service`
- **Purpose:** one-line domain summary.
- **Owner / escalation:** primary + secondary on-call.
- **Dependencies:** own Postgres DB (`civitas_<svc>`), Redis, SQS topics (`src/topics.ts`), upstream HTTP services, third parties (Keycloak/PFMS/eSign/S3).
- **Key dashboards:** ops route `/ops/*` (heartbeat, DLQ, errors); gateway `/ready`.
- **Common failure modes → action:**
  - *Consumer stalled* (heartbeat stale) → check worker process (`<svc>-worker`); restart; inspect last message; check DB connectivity.
  - *DLQ filling* → read DLQ message + `error`; if poison (validation) it's a bad producer → fix upstream; if transient → redrive after dependency recovers.
  - *Outbox relay failing* → check DB + SQS reachability; relay is idempotent, safe to resume.
  - *p95 latency high* → check Redis hit rate, DB slow queries, upstream latency.
  - *401 spike* → check Keycloak/JWKS reachability and `INTERNAL_SERVICE_SECRET`.
- **Rollback:** redeploy previous image tag; migrations are forward-only — never auto-rollback schema (restore from backup if required).
- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox; verify audit continuity.

---

## 6. Operational-maturity backlog (to reach full §38 compliance)

1. ~~**Emit p95 latency histograms** per route (OTel)~~ **DONE (PERF-1)** — `http_request_duration_ms` histogram per service/method/route on `/metrics`, with in-process `getHttpLatencyQuantile()` for SLO checks/tests.
2. ~~**Per-tenant rate/quota counters** for noisy-neighbor SLO (ties to threat T6).~~ **DONE (PERF-2)** — `http_requests_by_tenant_total{service,tenant}` (cardinality-capped, `_overflow` label).
3. ~~**Wire alerts** from the existing ops metrics into the alerting stack~~ **DONE** — `infra/observability/alert.rules.yml` adds p95 read SLO, auth-path p95 (150ms), per-tenant noisy-neighbor (warn/crit), and app-failure (captured errors / consumer errors / outbox relay) alerts.
4. **Backup/restore drill** to prove RPO ≤15 min / RTO ≤4 h (Charter §28.3, §38.6 "failure-testing evidence").
5. **Per-service runbook files** — split §5 into `docs/operations/runbooks/<service>.md` as ownership is assigned.
6. **Error budget reporting cadence** — monthly review per §38.3.
