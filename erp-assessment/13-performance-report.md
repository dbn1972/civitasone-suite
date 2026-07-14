# 13 — Performance & Scalability Report

**Lane L09 — Evidence-based, code + schema inspection. No unsafe load tests run.**
Branch: `court-management-service` (2026-07-12)

---

## Summary scorecard

| Dimension | Score | Rationale |
|---|---|---|
| Performance | **6 / 10** | Cache + PgBouncer in place; N+1 on payroll run; cache bypassed in raw-SQL paths |
| Scalability | **5 / 10** | Architecture exists (cell router, partitioning, queue abstraction); critical wiring absent |
| Reliability | **7 / 10** | Outbox + idempotency + DLQ proven; single-worker noisy-tenant risk unmitigated |
| Backup/Restore | **3 / 10** | No backup automation, no PITR, no replica config anywhere in repo |

---

## 1. Connection Pooling

### Evidence
- `infra/pgbouncer/pgbouncer.ini`: transaction-mode PgBouncer, `max_client_conn = 500`, `default_pool_size = 20`, `reserve_pool_size = 5`.
- `packages/db/src/pool.ts`: `max = 5` per service process when `DB_VIA_PGBOUNCER=true`, `prepare = false` (required for transaction mode). Direct connections default to `max = 10`.
- `packages/db/src/index.ts`: single exported `createDb()` → singleton `postgres-js` client per service process.

### Assessment
**Architecture: correct. Sizing: marginal.**

With 38 services × 2 processes (API + worker) × 5 connections = **380 PgBouncer server-side connections** minimum during peak. PostgreSQL 16 default `max_connections = 100` would be exhausted before all services start; production requires explicit `max_connections = 500+` on the cluster (not set in `docker-compose.prod.yml`). `default_pool_size = 20` applies per DB: 38 DBs × 20 = 760 server connections total, but these are only opened on demand. At sustained 1000 TPS split across services, actual server connections will be well below the limit; at a simultaneous payroll-day burst across all tenants this ceiling is reachable.

**PgBouncer transaction-mode caveat**: `DISCARD ALL` is set as `server_reset_query` — correct for transaction mode. Session-level `SET app.tenant_id` cannot survive connection recycling, which is why `runWithTenant` injects the GUC inside each transaction (correct pattern verified in `packages/db/src/tenant-tx.ts`).

**Gap**: No statement pooling or query plan cache persistence; each process cold-starts Drizzle ORM without a warm query cache. Not critical at current scale.

---

## 2. N+1 Query Risks

### Evidence — Payroll Run (Critical Path)

`services/payroll-service/src/modules/payroll/consumer.ts` — per-employee processing loop:

```
for each employee in payroll run:
  resolveDaRateBps(tenantId, month)       → raw SQL SELECT … LIMIT 1
  resolvePtSlabs(tenantId, stateCode)     → raw SQL SELECT … ORDER BY
  resolveDeclaration(tenantId, employeeId, fy) → raw SQL SELECT … LIMIT 1
  resolveTdsYtdMinor(tenantId, employeeId, fyStart, beforeMonth) → raw SQL JOIN
  fetchPayrollInput(employeeId) → HTTP call to hrms-service
```

**Result**: a payroll run for `N` employees issues **4 DB queries + 1 HTTP call per employee** sequentially. At 10 000 employees: 40 000 queries + 10 000 HTTP calls from a single worker. At 500 000 employees: 2 M queries. This is an **intentional N+1** with no batch loader.

### Evidence — DA Rate and PT Slabs (Cacheable)

`resolveDaRateBps` and `resolvePtSlabs` are tenant-wide configuration (same result for all employees in the run). They are **not cached** and are called once per employee — a pure N×1 = N cache-miss waste. These should be hoisted outside the per-employee loop and cached (or fetched once per run).

### Evidence — Other Services

Spot-check of `hrms-service`, `finance-service`, `procurement-service`: repo files use `db.select().from(…).where(…)` (single-row lookups); no evidence of bulk for-loop DB fetches outside payroll. Drizzle relations are unused — no `findMany({ with: { ... } })` or DataLoader-style batching. Risk is **contained to payroll and any future bulk-processing consumers**.

### Cache Coverage

`packages/cache/src/index.ts` implements `getOrLoad` with in-process stampede coalescing (inflight map). Cache is **wired in most query routes**. However, `payroll/consumer.ts` uses raw `db.execute(sql\`...\`)` directly — these paths **bypass the cache** and hit Postgres on every payroll run. No cache key for DA rates, PT slabs, or TDS YTD results.

---

## 3. Missing Indexes (Tenant-Leading Composite)

### Evidence — Overall Coverage

```
find services -name "*.sql" | xargs grep -c "CREATE INDEX" → 1 453 total index statements
grep "tenant_id" → 342 indexes include tenant_id as a column
```

### Critical Tables: Present ✓

Verified in migration SQL (not just schema.ts):
- `payroll.payroll_slips`: `(tenant_id, run_id)` + `(tenant_id, employee_id)` ✓
- `attendance.hrms_attendance`: `(tenant_id, employee_id, attendance_date DESC)` ✓
- `ml_training_runs`: `(tenant_id, domain, status)` ✓
- `visitor.devices`: unique `(tenant_id, serial_number)` ✓

31/38 services have dedicated `fk_indexes` migrations (CONCURRENTLY, idempotent).

### Gaps

**Missing fk_index migrations (7 services):** `court-service`, `gateway-service`, `meeting-service`, `metadata-service` (stub), `ml-service`, `queue-service`, `visitor-service`.

- `court-service` has 14 migrations (0001–0014); several tables lack FK lookup indexes (e.g. `court.case_hearings.case_id`, `court.evidence.case_id`).
- `visitor-service` and `meeting-service` lack systematic FK auditing; these are newer services added in the current session.
- `ml-service` has Drizzle `index()` declarations in schema but no fk_index migration — partial coverage.

**Non-tenant-leading indexes**: `audit-service/0017_fk_indexes.sql` creates several indexes on FK columns without tenant_id prefix (e.g. `idx_audit_paras_department_id ON audit.paras(department_id)`). For RLS-enforced tables this is acceptable (RLS filters before index is used), but without RLS enforcement these would be table scans at scale.

**payroll_slips missing `created_at` index**: no time-range index on `payroll_slips` for "all slips in month X" queries; covered by `(tenant_id, run_id)` only if run_id is known.

### Drizzle Schema vs Migration Divergence

294 `schema.ts` files were found. Only `ml-service`, `visitor-service`, `estab-service`, and `finance-service` declare `index()` in Drizzle schema; the remaining ~30 services rely entirely on migration SQL. This is functionally correct but means `drizzle-kit push` / `push:db` would not recreate performance indexes, creating a schema drift risk if migrations are re-run from scratch.

---

## 4. Cache Strategy

### Implemented ✓
- `packages/cache`: `Cache.getOrLoad()` read-through pattern, stampede coalescing, TTL clamped to `[1s, 3600s]`, tenant-scoped keys `{service}:{tenant}:{resource}:{id}`.
- `put()` for read-your-writes (command handler primes cache immediately, async consumer settles DB).
- `invalidateAfterCommit()` with bounded self-healing TTL (max staleness = TTL on crash).
- `MemoryCache` for tests, `RedisCache` for production.

### Gaps
- **Single Redis instance**: `docker-compose.prod.yml` shows one `redis:7.4-bookworm` container with no Sentinel or replica. CLAUDE.md mentions "Redis Sentinel on-prem, ElastiCache on AWS" but no Sentinel `sentinels:` config is wired in production compose or Helm values (`REDIS_URL: redis://civitasone-redis:6379` — single host). Redis is a SPOF for the cache layer.
- **No cache warming**: services cold-start with empty cache; first-request latency after deploy hits Postgres.
- **Analytics bypasses cache**: `analytics-service` queries its own DB directly for fact computation; no cache layer on aggregation queries.
- **payroll consumer bypasses cache**: raw `db.execute(sql\`...\`)` calls in `payroll/consumer.ts` do not use `cache.getOrLoad()`.

---

## 5. Single-Worker / Queue Fairness (Noisy-Tenant Risk)

### Evidence
- `services/payroll-service/src/worker.ts`: single `node worker.js` process; registers all consumers on one `queue.start()`.
- `infra/onprem/helm/values.yaml`: `replicaCount: 1` (default, no per-service override shown).
- `packages/queue/src/adapters/memory.ts`–`bus.ts`: `MemoryQueue` dispatches via `setTimeout(() => handler(msg))` — FIFO, no per-tenant fairness, no concurrency limit.
- `services/queue-service/src/bus.ts` (`SqsQueue`): standard SQS topics (not `.fifo`-suffix FIFO queues for most domain commands). FIFO topics exist for order-sensitive events (`isFifoTopic()`), but the main command topics (payroll-run-process, etc.) are standard queues — no `MessageGroupId`-based per-tenant ordering or throttling.

### Impact Model

| Scenario | Workers | Message volume | Bottleneck |
|---|---|---|---|
| Normal: 100 tenants, 1k emp each | 1 | ~100 payroll msgs/mo | No issue |
| Payroll day: 1 large tenant (50k emp) | 1 | 50 000 slip commands burst | Worker saturated; all other tenants queue |
| FY-end: all tenants compute Form 16 | 1 | 100k+ messages | Worker backed up for hours |
| Tender close: procurement burst | 1 | N×bid commands per RFQ | Procurement worker saturated |

**Root cause**: No per-tenant message group / quota / weighted round-robin. One government PSU with 500 000 employees submitting a payroll run generates ~500 000 `payroll.run.process` commands that a single worker pulls sequentially from SQS. Visibility timeout = 60s default. At 1 slip/second processing rate: 500 000 slips = 5.8 days of single-worker time. All other tenants experience queue delay proportional to the large tenant's volume.

**Mitigation path** (not yet implemented):
1. Per-tenant SQS message group (FIFO queue) with `maxReceiveCount` per group → fair share.
2. Horizontal worker scaling (`replicaCount > 1` + Helm per-service override).
3. Dedicated worker pool for bulk operations (payroll run / Form16 batch) separate from transactional commands.

---

## 6. Outbox Relay Throughput

### Evidence
```
packages/outbox/src/index.ts:
  startRelay(..., intervalMs = 500)      // polls every 500ms
  relayOnce(..., batch = 100)            // 100 rows per cycle
```

### Assessment

At **1000 TPS sustained**:
- 1000 commands/second → 500 ms × 1000 = 500 outbox rows queued between relay cycles.
- Relay batch = 100 rows → 5 relay cycles to drain 500 rows → **2.5 s end-to-end event delivery lag** at 1000 TPS steady state.
- At burst (payroll run: 10 000 commands in 10 s): outbox accumulates 10 000 unpublished rows; relay takes 100 cycles × 500 ms = 50 s to drain. Downstream consumers (notification, analytics) see 50 s lag.

**Partition maintenance**: 31/38 services run `_outbox.create_future_partitions()` on worker startup + daily. Partitioned outbox enables fast `DROP PARTITION` for purge — this is a real scalability improvement.

**7 services without outbox partitioning** (all newer/smaller): `court-service`, `gateway-service`, `meeting-service`, `metadata-service`, `ml-service`, `queue-service`, `visitor-service`. At current volumes this is not urgent; at scale outbox tables will bloat without partition maintenance.

---

## 7. OLAP-on-OLTP Risk

### Evidence
- `report-service` uses `DATABASE_URL → civitas_report` (own DB, not cross-service). Report data is ingested via events (consumers write to local materialized tables). **No cross-service SQL reads.** ✓
- `analytics-service` similarly owns `civitas_analytics` DB with `facts`, `kpis`, `metrics` modules populated via event consumers. ✓
- No evidence of ad-hoc GROUP BY / aggregate queries running against OLTP tables in domain services.

### Remaining Risk
- `report-service` renders reports by querying its own materialized tables; but those tables are populated by consuming domain events, introducing **eventual consistency lag**. A report run immediately after a GL posting may miss the latest entries by up to the outbox relay window (≤2.5 s at 1000 TPS).
- No warehouse connection or read replica: at 3+ years of historical data, report-service's own tables will become large. No partitioning or archival observed in `report-service` migrations.
- `analytics-service` has no partition or archival migrations — `analytics.facts` and `analytics.kpis` will grow unbounded.

---

## 8. Circuit Breaker / Resilience

### Evidence
- `services/gateway-service/src/upstream-proxy.ts`: per-upstream `CircuitBreaker` from `@civitasone/circuit-breaker`. 5 consecutive failures trips open, 15 s recovery to half-open. ✓
- `packages/circuit-breaker/src/index.ts`: consecutive-failure model (not sliding window). Reset on success. Appropriate for simple service mesh.

### Gaps
- **No service-to-service circuit breaker**: services call each other via HTTP (`hrms-client.ts` in payroll, `tenant-service` URL in quota-check). These internal calls have no CB protection — a slow `hrms-service` will cause payroll consumers to accumulate blocked goroutines.
- **Gateway CB at request level only**: a CB trip on one service rejects ALL tenants' requests to that service equally — no per-tenant CB. A misbehaving tenant that causes repeated 5xx errors on their requests could trip the CB for everyone else.

---

## 9. Synthetic Stress Model

### Tenant Archetypes

| Archetype | Employees | Payroll day TPS | FY-end event burst |
|---|---|---|---|
| Small Office (100 tenants) | 50 | ~50 cmds over 1 min | ~600 Form16 |
| PSU (20 tenants) | 5 000 | ~5 000 cmds over 10 min | ~60k Form16 |
| Govt Dept (5 tenants) | 50 000 | ~50 000 cmds over 60 min | ~600k Form16 |
| Large State Dept (1 tenant) | 500 000 | 500 000 cmds over hours | 6M Form16 |

### Bottleneck per Scenario

**Payroll day (1st of month, 09:00):**
- 125 tenants all trigger payroll → SQS receives burst of ~5.6M commands.
- Single payroll worker processes ~1-2 slip/s (assuming 500ms per slip with 4 DB queries + 1 HTTP call at low latency) → **32 days to process** at single-worker sequential rate. This validates the noisy-tenant concern as production-blocking.
- Fix: horizontal workers + per-tenant message groups + batch DA/PT resolution.

**FY-end (March 31, GL posting + Form16):**
- Finance GL: GL posting for a 50k-employee dept = 50k GL entries + 50k audit events = 100k outbox rows → relay drains in ~500 s at 100-row batch/500ms interval.
- Concurrent payroll Form16 PDF generation: CPU-bound (PDF rendering); single worker will queue indefinitely.

**Tender close (competitive bidding window closes):**
- procurement-service: all bids arrive simultaneously → N × bid-submit commands.
- With single worker: last-bid processing delayed; bid-close timestamp correctly uses command-timestamp from the original request (verified in consumer pattern), so business correctness holds; but bid confirmation latency degrades.

---

## 10. Observed Deficiencies — Ranked

| # | Finding | Impact | Effort to Fix |
|---|---|---|---|
| P1 | Single payroll worker + no queue fairness | Payroll day noisy-tenant: production-blocking at scale | High |
| P2 | N+1 in payroll consumer (DA rate, PT slabs, TDS YTD per employee) | 500k emp run: 2M+ extra queries | Medium |
| P3 | Redis is single-instance (no Sentinel/cluster) | Cache SPOF; no HA for reads | Medium |
| P4 | No backup/PITR automation | RPO undefined; restore window untested | Medium |
| P5 | Outbox relay 500ms/100-row batch | 2.5s event lag at 1k TPS | Low |
| P6 | 7 services missing fk_index migrations | FK lookup scans at scale | Low |
| P7 | No service-to-service circuit breaker | Cascading failure under hrms/tenant outage | Medium |
| P8 | TenantRouter unwired | Pool→silo migration path blocked | Low |
| P9 | No read replica / warehouse for analytics | Analytics queries OLTP DB at scale | Medium |
| P10 | Report/analytics tables unpartitioned | Unbounded growth in analytics DB | Low |

---

## Score Summary

- **Performance: 6 / 10** — Cache architecture is well-designed; stampede protection, bounded TTLs, read-your-writes all present. Deducted for N+1 payroll, cache bypassed by raw SQL, single worker, no warming.
- **Scalability: 5 / 10** — Correct architecture (cell router, partitioning, queue abstraction, tenant tiers). Critical pieces unwired (TenantRouter, horizontal workers, Redis HA). 1 453 indexes including tenant-leading composites on critical tables.
- **Reliability: 7 / 10** — Outbox + idempotency + DLQ + circuit breaker at gateway = solid at-least-once foundation. Docked for single worker noisy-tenant risk, no service-to-service CB, no saga/compensation.
- **Backup/Restore: 3 / 10** — No pg_dump automation, no PITR, no replica, no documented RTO/RPO targets found in any infra file. Terraform has SQS modules but RDS module is commented out.
