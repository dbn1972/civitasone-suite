# 14 — Growth Forecast (1 / 3 / 5 Year)

**Lane L09 — Evidence-based. Assumptions stated. No data from live production DBs.**
Branch: `court-management-service` (2026-07-12)

Cross-reference: `erp-assessment/02-architecture-discovery.md` (architecture), `erp-assessment/08-tenant-isolation-report.md` (tenancy tiers), `erp-assessment/13-performance-report.md` (bottlenecks).

---

## 1. Assumptions

| Parameter | Value | Source |
|---|---|---|
| Target market | Government depts, PSUs, Small Offices (India) | CLAUDE.md product context |
| Editions | Small Office / PSU / Govt Dept | infra/db/bootstrap/services.json |
| Services | 38 Fastify microservices, 559 tables across 38 DBs | counted from schema files |
| Tenancy tiers | pool (default RLS) / silo (dedicated DB) / shard (cell) | packages/db/src/tenant-router.ts |
| Initial load | Pilot: ~50 tenants, avg 1 000 employees | assumed go-live baseline |
| Growth rate | 3× tenants by Year 3, 10× by Year 5 (govt digitisation pipeline) | assumed |
| Row sizes | attendance 200 B, payroll slip 600 B (jsonb components), audit event 500 B, GL entry 400 B | schema inspection |
| Retention | audit events: rolling 90 days online + archive; outbox: 7 days (code); payroll slips: 7 years (statutory) | code + statutory |
| TPS | 100 (Year 1) → 500 (Year 3) → 1 000+ (Year 5) | CLAUDE.md target |

---

## 2. Tenant / Employee Volume Model

```
Year 1  (2027):   50 tenants   ×  avg 1 000 emp  =    50 000 total employees
Year 3  (2029):  200 tenants   ×  avg 2 500 emp  =   500 000 total employees
Year 5  (2031): 1 000 tenants  ×  avg 5 000 emp  = 5 000 000 total employees
```

Mix (Year 5): 750 small (<500 emp) + 200 medium (500–10k) + 50 large (10k–500k).
Largest single tenant: 500 000 employees (large state department).

---

## 3. DB Size Forecast

### 3.1 Table-by-Table Estimates (largest tables)

#### `attendance.hrms_attendance` (daily per employee)

| Year | Employees | Rows/year | Cumulative rows | Size |
|---|---|---|---|---|
| 1 | 50 000 | 18.25 M | 18.25 M | ~3.7 GB |
| 3 | 500 000 | 182.5 M | 420 M | ~84 GB |
| 5 | 5 000 000 | 1.83 B | 4.2 B | ~840 GB |

**Partition required by Year 2.** `hrms-service` has NO partition migration for `hrms_attendance` today — this is the most urgent omission. Without monthly range partitioning, a `DELETE` of old attendance rows at Year 5 volumes will lock the table for hours.

#### `payroll.payroll_slips` (monthly per employee)

| Year | Slips/year | Cumulative | Size |
|---|---|---|---|
| 1 | 600 000 | 600 000 | ~360 MB |
| 3 | 6 000 000 | 15 M | ~9 GB |
| 5 | 60 000 000 | 150 M | ~90 GB |

7-year statutory retention → **Year 5 cumulative: 420M rows, ~252 GB for payroll_slips alone.**
tenant_id-leading composite indexes exist (`idx_payroll_slips_run`, `idx_payroll_slips_employee`) — ✓. Partition by `(tenant_id, month YYYY-MM)` recommended before Year 3.

#### `events.events` (audit — partitioned monthly)

| Year | TPS | Events/day | Rows/year | Online (90d) | Archive/year |
|---|---|---|---|---|---|
| 1 | 100 | 8.64 M | 3.15 B | ~158 GB | ~420 GB |
| 3 | 500 | 43.2 M | 15.77 B | ~788 GB | ~2.1 TB |
| 5 | 1 000 | 86.4 M | 31.5 B | ~1.6 TB | ~4.2 TB |

**Critical**: audit-service has monthly partitioning (`0014_partition_audit_events.sql`) with auto-create 3 months ahead ✓. BUT no archival policy or cold-storage export is coded. At Year 3, the audit DB grows by ~2 TB/year; without partition DROP + S3/Glacier archival, `civitas_audit` DB hits multi-TB territory. A partition purge cron must be added no later than **Year 2**.

Audit event size includes correlationId, actorId, payload (jsonb), tenantId — 500 B/row average.

#### `_outbox.messages` (steady-state, purged after 7 days)

31/38 services have monthly outbox partitioning. At 1 000 TPS all services combined:
- 86.4 M outbox rows/day across 38 services.
- Relay publishes within 500ms; purge hourly; 7-day retention.
- Steady-state size per service: ~7 days × (service-share of TPS) × avg_row_size.
- High-volume services (payroll, hrms, finance): ~500 MB steady-state each.
- If relay backs up (single-worker saturation on payroll day), outbox swells at rate = TPS × 600B/row × hours_of_backlog. At 1 000 TPS for 8h backlog: **~17 GB** accumulation per service.

#### GL Entries `gl.gl_entries`

| Year | Postings/day (all tenants) | Cumulative | Size |
|---|---|---|---|
| 1 | 200 000 | 73 M | ~29 GB |
| 3 | 2 M | 730 M | ~292 GB |
| 5 | 20 M | 7.3 B | ~2.9 TB |

finance-service has `0002_perf_indexes.sql` but no GL partition. At Year 5, the GL table is 2.9 TB with no partition support — **queries filtering by `(tenant_id, date_range)` will be slow beyond the reach of any B-tree index**. Partition `gl_entries` by `(tenant_id, fiscal_year)` by Year 3.

### 3.2 Total DB Size Summary

| Year | hrms | payroll | audit (online) | finance | other 34 DBs | **Total** |
|---|---|---|---|---|---|---|
| 1 | ~8 GB | ~0.5 GB | ~160 GB | ~30 GB | ~50 GB | **~250 GB** |
| 3 | ~200 GB | ~20 GB | ~800 GB | ~300 GB | ~300 GB | **~1.6 TB** |
| 5 | ~2 TB | ~300 GB | ~1.6 TB (online) | ~3 TB | ~2 TB | **~9 TB+** |

---

## 4. Redis Memory Forecast

Cache key convention: `{service}:{tenant}:{resource}:{id}`, TTL up to 3600s.

### Active-cache model

Per active tenant, hot entities per service (estimated):
- 38 services × 50 hot entities/service × 1 KB avg serialised value = **1.9 MB/tenant**.
- Active tenants at once: ~10% of registered (concurrent working hours).

| Year | Tenants | Active | Redis RAM (cache) |
|---|---|---|---|
| 1 | 50 | 5 | ~10 MB |
| 3 | 200 | 20 | ~38 MB |
| 5 | 1 000 | 100 | ~190 MB |

Cache RAM is not the constraint. The constraint is:

**Queue rate-counters** (quota-check plugin: `quota:{tenantId}` counter, 60s TTL) and **session tokens** from identity-service → negligible.

**Scaling trigger for Redis**: not RAM but **connection count**. At 38 services × 2 processes each = 76 Redis clients. At `replicaCount = 3` (horizontal scaling) = 228 connections. Redis default `maxclients = 10 000` — fine. Real trigger is **Sentinel → Cluster migration** when cache hit rate on a single node drops due to memory pressure, which happens around Year 4–5 if hot-set grows (large analytics queries warming).

---

## 5. Queue Throughput Forecast

### Production queue: SQS Standard + SQS FIFO

| Year | Peak TPS (command burst) | SQS throughput | Verdict |
|---|---|---|---|
| 1 | 500 | Unlimited (standard) | Fine |
| 3 | 2 000 | Unlimited (standard) | Fine |
| 5 | 5 000+ | Unlimited (standard) | Fine — SQS scales infinitely |

**SQS is not a throughput bottleneck**. The bottleneck is the single-worker consumer, not the broker.

### Worker processing throughput

Each service runs 1 worker process. At payroll:
- 1 payroll slip processed in ~500ms (4 DB queries + 1 HTTP = ~125ms each).
- Peak: 10 slips/s per single worker → **500k-employee run takes 13.9 hours on one worker**.
- To meet a 1-hour SLA: need **14 worker replicas** for the payroll service alone.

**Scaling trigger**: add `payroll-service` to horizontal pod autoscaler (HPA) based on SQS queue depth. Require FIFO queue with `MessageGroupId=runId` (not tenantId) to parallelise across runs while keeping per-run ordering.

### Outbox relay throughput

At 1 000 TPS, `relayOnce` at 500ms/100-row: maximum relay rate = **200 events/s** per service.
Net: 200 events/s out per service × 38 services = 7 600 events/s capacity. At 1 000 TPS inbound: fine in aggregate; tight per high-volume service (payroll, audit at peak).

To reach 1 000 TPS per service: increase `batch` to 1 000, decrease `intervalMs` to 100ms.

---

## 6. Audit & File Storage

### Audit log archival

```
Monthly partition DROP after archival = 0-downtime purge (partitioned table) ✓
Target: keep 90 days online, archive to S3/Glacier on partition close.
```

| Year | Archived per year | Cumulative archive |
|---|---|---|
| 1 | ~420 GB | 420 GB |
| 3 | ~2.1 TB | 4.5 TB |
| 5 | ~4.2 TB | 16.5 TB |

S3 cost at IA storage (~$0.0125/GB/mo): Year 5 archive = $206/mo. Negligible. Glacier: $33/mo.

### File/object storage (estab-service, grant-service, procurement)

- Estimated 5 documents/employee/year at avg 500 KB = 2.5 MB/emp/year.
- Year 5 (5M emp): 12.5 TB/year new file storage. Cumulative 5 years: ~40 TB.
- S3 standard ($0.023/GB/mo) at 40 TB: $920/mo. Fine.

---

## 7. Backup and Restore Window

This is the **most critical under-engineered dimension**.

### Current state
- No `pg_dump` automation found in any infra file.
- No PITR (Point-in-Time Recovery) configuration.
- No streaming replica in `docker-compose.prod.yml` or Helm values.
- Terraform modules for RDS are **commented out** (`# module "rds" {...}` in `infra/aws/main.tf`).

### Projected restore windows (pg_dump/restore)

| Year | DB size | pg_dump time | pg_restore time | RTO |
|---|---|---|---|---|
| 1 | 250 GB | ~15 min | ~45 min | ~1 h |
| 3 | 1.6 TB | ~1.6 h | ~5 h | ~7 h |
| 5 | 9 TB | ~9 h | ~27 h | ~36 h |

A 36-hour RTO at Year 5 is unacceptable for a government ERP. **Streaming replication + PITR must be implemented before go-live**, not deferred to Year 2.

### Recommended minimum for go-live
1. PostgreSQL streaming replica (`hot_standby=on`) for read offload + HA.
2. `pg_basebackup` nightly to S3 (`wal_level=replica`, `archive_mode=on`).
3. WAL archival to S3 → PITR to 5-minute RPO.
4. Terraform `rds` module uncommented + configured with `backup_retention_period = 7` (AWS) or Barman/pgBackRest (on-prem).

---

## 8. DB Connections at Scale

### Per-service model
- 38 services × 2 processes (API + worker) × 5 PgBouncer connections = 380 server connections.
- At `replicaCount = 3` (horizontal): 38 × 6 × 5 = 1 140 server connections.
- PgBouncer `default_pool_size = 20` per DB × 38 DBs = 760 pooled server slots.
- PostgreSQL `max_connections` must be ≥ 1 140 + 50 (admin/monitoring). Current ini does not set a Postgres-side `max_connections` — must be explicit.

### Multi-cell model (Year 4+)
- Cell = 1 PgBouncer + 1 PostgreSQL primary + 1 replica + N service instances.
- Tenant router (`packages/db/src/tenant-router.ts`) is designed for this: pool/silo/shard tiers.
- Currently **unwired** in all 38 services (they use singleton `createDb()`). Wiring requires replacing singleton with `router.dbFor(tenantId)` per-request — a mechanical but non-trivial rollout.

---

## 9. Inflection Points — When to Act

| Trigger | When (approx.) | Action Required |
|---|---|---|
| First 50k-employee tenant | **Year 1–2** | Move tenant to silo tier (wire TenantRouter); partition `hrms_attendance` |
| Audit DB > 500 GB | **Year 2** | Deploy audit-partition archival cron to S3/Glacier; implement PITR |
| Payroll day SLA breach (>1 hr) | **Year 2** | Horizontal payroll workers + SQS FIFO per-run message group |
| Shared DB total > 1 TB | **Year 2–3** | Deploy cell-0 (first shard cell); wire TenantRouter env-based resolver |
| Analytics query p95 > 200ms | **Year 2–3** | Analytics service → external warehouse (Redshift/BigQuery); report-service API over warehouse |
| Redis Sentinel → Cluster | **Year 3** | Sentinel already mentioned in CLAUDE.md; wire actual Sentinel config in production compose |
| GL table > 500 GB | **Year 3** | Partition `gl.gl_entries` by fiscal year |
| Outbox relay lag > 5 s | **Year 3** | Increase relay batch to 1 000, reduce interval to 100ms; or dedicated relay workers |
| DB connections > 1 000 | **Year 3** | PgBouncer server-side `max_server_connections = 500` per pool; or add PgBouncer instances per cell |
| Backup restore window > 4 h | **Year 2–3** | PITR is mandatory; pg_dump-based restore is no longer viable |
| payroll_slips > 50 M rows | **Year 3–4** | Partition `payroll.payroll_slips` by `(tenant_id hash, month)` |
| New cell required | **Year 4** | Cell architecture fully deployed; each cell = pool of ~100 tenants |
| analytics → warehouse | **Year 3–4** | ClickHouse or BigQuery; analytics-service becomes a thin API proxy |

---

## 10. Resilience Posture (§25)

### At-least-once delivery (proven ✓)
- Transactional outbox (`packages/outbox`): DB write + outbox row in same transaction → event guaranteed delivered after commit.
- Idempotent consumers: `markProcessed(tx, messageId)` → `ON CONFLICT DO NOTHING` in `_inbox.processed` → exactly-once semantics at the application layer.
- DLQ: SQS max_receive_count = 5, DLQ retention = 14 days (from Terraform SQS module). `NonRetryableError` routes directly to DLQ. ✓

### Retry / backoff
- `MemoryQueue` (dev/test): 5 immediate retry attempts, then DLQ. **No exponential backoff** — a transient DB blip causes 5 rapid retries before DLQ, which can overwhelm a recovering service. SQS production: visibility timeout = 60s; AWS handles re-enqueue with natural backoff via visibility timeout extension.
- Gap: no jitter/exponential backoff in `MemoryQueue`; this matters only for test fidelity but risks flaky tests masking real behaviour.

### Rollback / saga
- No distributed saga or compensation pattern visible. Services use the outbox for fire-and-forget event publishing. If a downstream consumer permanently fails (DLQ after 5 retries), there is **no compensating transaction** to roll back the upstream committed state.
- Example: `payroll.run.process` commits a slip, publishes `notification.send` → if notification DLQs, the slip exists but the employee never received it. Manual recovery required.
- For government ERP, saga compensation is low-priority (all-or-nothing payroll run is more typical), but **DLQ monitoring and alerting** is required in production.

### Circuit breaker
- Gateway-level per-service CB ✓ (5 consecutive failures, 15s half-open). `@civitasone/circuit-breaker` is zero-dependency, in-process — correct for gateway's single process.
- **No service-to-service CB**: payroll → hrms HTTP calls, quota-check → tenant-service HTTP calls have no CB wrapper.
- **Module-guard and quota-check plugins are dormant** (not wired in any service's `app.ts`): per-architecture-discovery report. This means per-tenant rate limiting is not active in production.

### Helm / Kubernetes readiness
- Helm chart at `infra/onprem/helm/values.yaml` with `replicaCount: 1`.
- No `readinessProbe`, `livenessProbe`, `podDisruptionBudget`, or `HorizontalPodAutoscaler` config visible in the Helm templates (not checked in detail — infra/onprem/helm/ not fully explored).
- Every service exposes `/health` (per CLAUDE.md §3.5 rule) — correct prerequisite for K8s probes.

---

## 11. Five-Year Summary

```
Year 1 (2027):  250 GB total DB. Single cluster + single PgBouncer. Cache fine.
                Action: wire PITR + streaming replica. Partition hrms_attendance.
                
Year 2 (2028):  ~500 GB. First large tenants → silo tier (TenantRouter wiring).
                Audit archival cron deployed. Payroll workers scaled to 3 replicas.
                Action: implement audit archival, horizontal payroll workers, Redis Sentinel.
                
Year 3 (2029):  1.6 TB. Shared DB under pressure on payroll day.
                First cell required (top-10 largest tenants on cell-0).
                Analytics → warehouse transition begins.
                Action: deploy cell, partition GL + payroll_slips, ClickHouse/BigQuery.
                
Year 4 (2030):  3–4 TB. 3–4 cells. Analytics fully decoupled.
                Redis cluster (ElastiCache cluster mode).
                Payroll: per-run FIFO parallelism, 10+ worker replicas.
                
Year 5 (2031):  9+ TB across 5–10 cells. 
                PITR across all cells. Dedicated analytics warehouse.
                Per-tenant DB isolation for top 50 tenants (enterprise silo).
                Backup window via streaming PITR: RPO = 5 min, RTO < 30 min per cell.
```

---

## Score Summary (repeated from report 13)

| Dimension | Score | Key evidence |
|---|---|---|
| Performance | **6 / 10** | Cache + indexes present; N+1 payroll + single worker + cache bypass in raw SQL |
| Scalability | **5 / 10** | Cell router + partitioning + queue abstraction architected; all unwired |
| Reliability | **7 / 10** | Outbox + idempotency + DLQ solid; no service-to-service CB; no saga |
| Backup/Restore | **3 / 10** | No pg_dump automation, no PITR, no replica; Terraform RDS module commented out |
