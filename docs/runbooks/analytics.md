# Runbook: analytics-service

> **Tier 2** | SLO: 99.5% availability, query execution p95 < 5s, fact ingestion lag < 60s, DLQ = 0  
> **Last tested:** DR drill (weekly automated) | **Last game-day:** —  
> **Owner:** Data/Analytics Domain Owner | **Escalation:** SRE → CTO  
> **Slack:** `#incident-analytics` | **PagerDuty:** `analytics-critical`  

---

## Purpose

Cross-domain analytics engine — ingests domain events from 12+ services into a unified fact store, provides ad-hoc query execution, saved metric/KPI definitions, dashboard composition (widgets), scheduled report exports, and tenant-scoped data sharing. Read-heavy, eventually consistent projection of the entire platform's business events. Owns `civitas_analytics` on port 3031. If analytics is down, decision-maker dashboards go stale, scheduled reports stop, and export jobs fail.

---

## Dependencies

| Dependency | Health Check | Failure Impact |
|-----------|-------------|----------------|
| Postgres (`civitas_analytics`) | `curl -s http://analytics:3031/ready \| jq .checks.db` | Total outage — queries and fact storage halt |
| Redis | `curl -s http://analytics:3031/ready \| jq .checks.cache` | Query result cache unavailable (queries hit DB directly) |
| SQS/RabbitMQ | `curl -s http://analytics:3031/ready \| jq .checks.queue` | Fact ingestion stops, commands unprocessed |
| S3/MinIO (exports) | `curl -s http://analytics:3031/ops/circuit-breakers \| jq .storage` | Export jobs fail (queued safely) |
| finance-service (events) | `curl -s http://finance:3007/health` | Finance facts stop flowing |
| court-service (events) | `curl -s http://court:3034/health` | Judiciary facts stop flowing |
| project-service (events) | `curl -s http://project:3014/health` | Project/scheme facts stop flowing |

**Inbound events consumed:** `finance.payment.released`, `grants.release.processed`, `procurement.po.approved`, `meeting.attendance.marked`, `meeting.vote.concluded`, `meeting.meeting.completed`, `court.case.registered`, `court.case.status_changed`, `court.hearing.scheduled`, `visitor.checked_in`, `visitor.overstay.alerted`

**Events produced:** `analytics.query.run.completed`, `analytics.query.run.failed`, `analytics.dashboard.created`, `analytics.export.created`

---

## Key Dashboards

| Dashboard | URL Template | Purpose |
|-----------|-------------|---------|
| Analytics Overview | `https://grafana.internal/d/analytics-overview` | p95 query latency, error rate, throughput |
| Fact Ingestion | `https://grafana.internal/d/analytics-ingestion` | Events/sec by source, ingestion lag, consumer backlog |
| DLQ Monitor | `https://grafana.internal/d/analytics-dlq` | DLQ depth by inbound topic |
| Export Jobs | `https://grafana.internal/d/analytics-exports` | Export success/failure rate, S3 write latency |
| Query Performance | `https://grafana.internal/d/analytics-queries` | p50/p95/p99 query time, cache hit ratio |

---

## Failure Modes

### FM-01: Fact ingestion lag increasing (dashboards stale)

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 10 min |
| **Alert** | `analytics_ingestion_lag_seconds > 60` for 5 min |
| **Impact** | Decision-maker dashboards show stale data — trust erosion, real-time KPIs unreliable |

**Triage:**

```
Ingestion lag increasing
├── Is it one topic or all topics?
│   → curl -s http://analytics:3031/ops/consumer-status | jq '.consumers | to_entries[] | {topic: .key, lag: .value.lagSeconds}'
│   ├── Single topic lagging → Source-specific issue
│   │   → Check if the source service is producing a burst (e.g., finance month-end)
│   │   → Check for a poison message on that topic
│   │   → curl -s http://analytics:3031/ops/dlq/peek?topic={topic}&limit=3 | jq .
│   │   ├── DLQ entries → Schema change in source event broke materialization
│   │   │   → Inspect payload. Is a required field missing?
│   │   │   → Coordinate with source service team
│   │   └── No DLQ → Consumer slow. Check query plan of INSERT into fact table
│   │       → EXPLAIN ANALYZE the materialization query
│   └── All topics lagging → Worker overloaded or DB saturated
│       ├── Check DB connections: psql civitas_analytics -c "SELECT count(*) FROM pg_stat_activity;"
│       │   → If near pool limit (20) → Connection exhaustion
│       │   → Kill idle connections or increase pool
│       ├── Check worker CPU/memory: docker stats civitasone-analytics-worker
│       │   → If CPU > 90% → Scale horizontally
│       └── Check if fact table needs VACUUM
│           → psql civitas_analytics -c "SELECT relname, n_dead_tup FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 5;"
├── Was there a recent deployment?
│   → Check if new inbound topic was added without index on fact table
│   → Review recent migrations
└── Is this a periodic spike (month-end, quarter-end)?
    → Finance month-end can produce 10x normal event volume
    → Temporary. Monitor and let it catch up.
```

**Commands:**

```bash
# Check per-topic consumer lag
curl -s http://analytics:3031/ops/consumer-status | jq '.consumers'

# Check overall ingestion rate
curl -s http://analytics:3031/ops/metrics | grep analytics_facts_ingested_total

# Check DB connection pool utilization
psql civitas_analytics -c "SELECT count(*), state FROM pg_stat_activity WHERE datname = 'civitas_analytics' GROUP BY state;"

# Check for slow materializations
psql civitas_analytics -c "
  SELECT source_topic, AVG(materialization_ms) as avg_ms, MAX(materialization_ms) as max_ms
  FROM analytics.ingestion_log
  WHERE created_at > NOW() - INTERVAL '10 minutes'
  GROUP BY source_topic
  ORDER BY avg_ms DESC;
"

# Check dead tuples (bloat)
psql civitas_analytics -c "SELECT relname, n_dead_tup, last_autovacuum FROM pg_stat_user_tables WHERE schemaname = 'analytics' ORDER BY n_dead_tup DESC LIMIT 5;"

# Restart worker if stuck
docker restart civitasone-analytics-worker

# Check DLQ for poisoned events
curl -s http://analytics:3031/ops/dlq | jq '.topics[] | select(.depth > 0)'
```

**Verification after fix:**

```bash
# Ingestion lag dropping
watch -n5 'curl -s http://analytics:3031/ops/metrics | grep analytics_ingestion_lag'

# All consumers processing
curl -s http://analytics:3031/ops/consumer-status | jq '.consumers | to_entries[] | select(.value.lagSeconds > 5)'

# Dashboard freshness check
curl -s "http://analytics:3031/v1/analytics/dashboards/health" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.staleDashboards'
```

**Communication template:**

> 🟠 **[P1] Analytics — Fact ingestion lag elevated**  
> Ingestion lag: {N}s (threshold: 60s). Affected topics: {topic list}.  
> Decision-maker dashboards may show stale data (~{N} min behind).  
> Root cause: {consumer overload | DB saturation | source burst | schema break}.  
> ETR: {5 min for restart | 30 min for schema fix | self-resolving for burst}.

---

### FM-02: Query execution timeout (ad-hoc queries failing)

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `analytics_query_failure_rate > 5%` for 5 min |
| **Impact** | Users cannot run analytics queries — reports fail, dashboards partially broken |

**Triage:**

```
Query timeouts
├── Is it a specific query or all queries?
│   → psql civitas_analytics -c "SELECT query_id, tenant_id, duration_ms, status
│      FROM analytics.query_runs WHERE status = 'failed'
│      AND created_at > NOW() - INTERVAL '30 minutes'
│      ORDER BY duration_ms DESC LIMIT 10;"
│   ├── Specific query → User wrote an expensive cross-domain join
│   │   → Check EXPLAIN ANALYZE for the query
│   │   → Common: missing index on partition key (tenant_id + time)
│   │   → Add time-bound constraint or suggest narrower filters
│   └── All queries → DB overloaded
│       ├── Check for long-running transactions locking tables
│       │   → psql: SELECT pid, duration, query FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC;
│       ├── Check if fact ingestion is competing for connections
│       └── Check disk I/O: iostat -x 1 3
├── Is the query cache working?
│   → curl -s http://analytics:3031/ops/metrics | grep analytics_cache_hit_ratio
│   ├── Ratio < 60% → Cache not effective. Check Redis.
│   └── Ratio normal → Cache is fine, problem is uncached queries
└── Was a new fact table created without proper indexes?
    → psql civitas_analytics -c "SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'analytics';"
```

**Commands:**

```bash
# Check recent query failures
psql civitas_analytics -c "
  SELECT query_id, tenant_id, duration_ms, error_message
  FROM analytics.query_runs
  WHERE status = 'failed' AND created_at > NOW() - INTERVAL '30 minutes'
  ORDER BY created_at DESC LIMIT 10;
"

# Check cache hit ratio
curl -s http://analytics:3031/ops/metrics | grep analytics_cache_hit

# Check for long-running queries blocking others
psql civitas_analytics -c "
  SELECT pid, NOW() - pg_stat_activity.query_start AS duration, query
  FROM pg_stat_activity
  WHERE datname = 'civitas_analytics' AND state = 'active'
  ORDER BY duration DESC LIMIT 5;
"

# Kill a runaway query (replace PID)
psql civitas_analytics -c "SELECT pg_terminate_backend({pid});"

# Check fact table indexes
psql civitas_analytics -c "
  SELECT tablename, indexname, indexdef
  FROM pg_indexes WHERE schemaname = 'analytics'
  ORDER BY tablename;
"

# Check DB size and bloat
psql civitas_analytics -c "
  SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) as size
  FROM pg_catalog.pg_statio_user_tables
  WHERE schemaname = 'analytics'
  ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;
"
```

**Verification after fix:**

```bash
# Query success rate recovering
curl -s http://analytics:3031/ops/metrics | grep analytics_query_success_total

# p95 latency back under SLO
curl -s http://analytics:3031/ops/metrics | grep 'analytics_query_duration.*quantile="0.95"'

# No more failed queries
psql civitas_analytics -c "
  SELECT COUNT(*) FROM analytics.query_runs
  WHERE status = 'failed' AND created_at > NOW() - INTERVAL '5 minutes';
"
```

**Communication template:**

> 🟡 **[P2] Analytics — Query execution degraded**  
> {N}% of queries failing (threshold: 5%). Affected: {all tenants | specific tenant}.  
> Root cause: {expensive query | missing index | DB overloaded | disk I/O}.  
> Dashboards with cached data still display. New queries may timeout.  
> ETR: {10 min for kill + index | 1h for capacity scaling}.

---

### FM-03: Scheduled export jobs failing

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Time to act** | < 30 min |
| **Alert** | `analytics_export_failure_total` increasing > 2/hour |
| **Impact** | Scheduled reports not delivered — compliance reports, executive summaries delayed |

**Triage:**

```
Export jobs failing
├── Check export error type
│   → psql civitas_analytics -c "SELECT id, error_code, error_message, created_at
│      FROM analytics.export_jobs WHERE status = 'failed'
│      AND created_at > NOW() - INTERVAL '2 hours' ORDER BY created_at DESC LIMIT 5;"
│   ├── "STORAGE_UNREACHABLE" → S3/MinIO connectivity issue
│   │   → curl -s http://analytics:3031/ops/circuit-breakers | jq .storage
│   │   → Check S3_ENDPOINT, bucket permissions
│   ├── "QUERY_TIMEOUT" → Export dataset too large
│   │   → Suggest narrowing date range or adding filters
│   │   → Check: is the export spanning all-time data?
│   ├── "MEMORY_EXCEEDED" → Export result set too large for in-memory processing
│   │   → Need streaming export (batch pagination)
│   └── "PERMISSION_DENIED" → IAM/bucket policy issue
│       → Check AWS credentials or MinIO access key
├── Is the export worker alive?
│   → curl -s http://analytics:3031/ops/consumer-status | jq '.consumers["analytics.export.create"]'
└── Were credentials rotated recently?
    → docker exec civitasone-analytics env | grep -E "S3_|MINIO_" | sed 's/=.*/=***/'
```

**Commands:**

```bash
# Check recent export failures
psql civitas_analytics -c "
  SELECT id, query_id, format, error_code, created_at
  FROM analytics.export_jobs
  WHERE status = 'failed' AND created_at > NOW() - INTERVAL '6 hours'
  ORDER BY created_at DESC LIMIT 10;
"

# Check storage circuit breaker
curl -s http://analytics:3031/ops/circuit-breakers | jq '.storage'

# Retry failed exports (after fixing root cause)
curl -X POST http://analytics:3031/ops/exports/retry-failed \
  -H "Content-Type: application/json" \
  -d '{"since": "2026-07-26T00:00:00Z", "batchSize": 10}'

# Check S3/MinIO connectivity
curl -s http://analytics:3031/ops/storage-health | jq .

# Check export worker consumer
curl -s http://analytics:3031/ops/consumer-status | jq '.consumers["analytics.export.create"]'
```

**Verification after fix:**

```bash
# Exports succeeding
curl -s http://analytics:3031/ops/metrics | grep analytics_export_success_total

# No pending failed exports
psql civitas_analytics -c "
  SELECT COUNT(*) FROM analytics.export_jobs
  WHERE status = 'failed' AND created_at > NOW() - INTERVAL '1 hour';
"
```

**Communication template:**

> 🟡 **[P2] Analytics — Scheduled export jobs failing**  
> {N} exports failed in last hour. Root cause: {S3 unreachable | query timeout | memory exceeded}.  
> Historical dashboard data unaffected. Scheduled reports delayed.  
> ETR: {10 min for storage fix | requires user to narrow query for size issues}.

---

### FM-04: DLQ on inbound domain events

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Time to act** | < 15 min |
| **Alert** | `analytics_dlq_depth{topic=~".*"} > 0` |
| **Impact** | Fact store has gaps — affected domain's analytics/dashboards become inaccurate |

**Triage:**

```
DLQ on inbound events
├── Which topic?
│   → curl -s http://analytics:3031/ops/dlq | jq '.topics[] | select(.depth > 0)'
│   ├── finance.payment.released → Finance facts have gap
│   ├── court.case.registered → Judiciary facts have gap
│   ├── meeting.* → Governance facts have gap
│   └── visitor.* → Premises facts have gap
├── Read the DLQ error
│   → curl -s http://analytics:3031/ops/dlq/peek?topic={topic}&limit=3 | jq '.[].error'
│   ├── "UNKNOWN_FIELD" → New field in source event (forward-compatible — should not DLQ!)
│   │   → BUG: consumer not tolerating unknown fields. Hotfix needed.
│   ├── "REQUIRED_FIELD_MISSING" → Source removed a field (breaking change!)
│   │   → Coordinate with source service team
│   │   → Temporary: add fallback/default for missing field
│   ├── "MATERIALIZATION_ERROR" → Fact table INSERT failed
│   │   → Check constraint violation, data type mismatch
│   └── "DB_CONNECTION_ERROR" → Transient. Safe to redrive after DB recovers.
└── Is this a bulk replay from source? (e.g., outbox replay after source service recovery)
    → Large batch DLQ after a source outage → likely a schema version mismatch
    → Inspect payload version field
```

**Commands:**

```bash
# Check all DLQ topics with depth
curl -s http://analytics:3031/ops/dlq | jq '.topics[] | select(.depth > 0) | {topic, depth}'

# Peek specific topic DLQ
curl -s http://analytics:3031/ops/dlq/peek?topic=finance.payment.released&limit=5 | jq '.[0] | {error, payload}'

# Redrive after fix (small batch first)
curl -X POST http://analytics:3031/ops/dlq/redrive \
  -H "Content-Type: application/json" \
  -d '{"topic": "finance.payment.released", "batchSize": 5}'

# Check fact table for gaps
psql civitas_analytics -c "
  SELECT source_topic, date_trunc('hour', ingested_at) as hour, COUNT(*)
  FROM analytics.fact_events
  WHERE ingested_at > NOW() - INTERVAL '24 hours'
  GROUP BY source_topic, hour
  ORDER BY source_topic, hour;
"

# Acknowledge truly unprocessable messages (after investigation)
curl -X POST http://analytics:3031/ops/dlq/ack \
  -H "Content-Type: application/json" \
  -d '{"messageIds": ["msg-id-1"]}'
```

**Verification after fix:**

```bash
# DLQ empty
curl -s http://analytics:3031/ops/dlq | jq '.topics[] | select(.depth > 0)'

# Fact ingestion resumed
curl -s http://analytics:3031/ops/metrics | grep analytics_facts_ingested_total

# Gap check — no missing hours
psql civitas_analytics -c "
  SELECT source_topic, date_trunc('hour', ingested_at) as hour, COUNT(*)
  FROM analytics.fact_events
  WHERE ingested_at > NOW() - INTERVAL '6 hours'
  GROUP BY source_topic, hour
  ORDER BY source_topic, hour;
"
```

**Communication template:**

> 🟠 **[P1] Analytics — DLQ on inbound fact events**  
> Topic: `{topic}`, depth: {N}. Root cause: {schema break | materialization error | DB transient}.  
> Dashboards for {domain} may show gaps for the affected time window.  
> Core service operations unaffected (analytics is read-only projection).  
> ETR: {5 min for transient redrive | coordination needed for schema break}.

---

### FM-05: Dashboard rendering stale (cache not expiring)

| Field | Value |
|-------|-------|
| **Severity** | P3 |
| **Time to act** | < 1 hour |
| **Alert** | Manual report (users seeing old data despite recent events) |
| **Impact** | Decision-makers see outdated KPIs — low trust in analytics platform |

**Triage:**

```
Stale dashboard data
├── Is it beyond the normal TTL (60s for dashboards)?
│   → Check when the data was last refreshed
│   → curl -s "http://analytics:3031/v1/analytics/dashboards/{id}" -H "Authorization: Bearer $TOKEN" | jq '.data.lastRefreshedAt'
│   ├── Last refresh > 5 min ago → Cache stuck or query failing
│   │   → Check Redis health: redis-cli -p 6381 PING
│   │   → Check if TTL is set: redis-cli -p 6381 TTL "analytics:{tenant}:dashboard:{id}"
│   │   ├── TTL = -1 → Key persisted without expiry. BUG.
│   │   │   → Manual fix: redis-cli -p 6381 EXPIRE "analytics:{tenant}:dashboard:{id}" 60
│   │   └── TTL normal → Query behind the cache is failing silently
│   │       → Check analytics.query_runs for that dashboard's queries
│   └── Last refresh < 60s → Data IS fresh. Issue is upstream (source events delayed).
│       → Check fact ingestion lag (see FM-01)
└── Is the underlying fact table updated?
    → psql civitas_analytics -c "SELECT MAX(ingested_at) FROM analytics.fact_events WHERE source_topic = '{relevant_topic}';"
    → If fact table is current, cache/query issue. If stale, source issue.
```

**Commands:**

```bash
# Check Redis health
redis-cli -p 6381 PING

# Check cache key TTL for a dashboard
redis-cli -p 6381 TTL "analytics:{tenantId}:dashboard:{dashboardId}"

# Force cache invalidation for a specific dashboard
redis-cli -p 6381 DEL "analytics:{tenantId}:dashboard:{dashboardId}"

# Check fact table freshness per source
psql civitas_analytics -c "
  SELECT source_topic, MAX(ingested_at) as latest, NOW() - MAX(ingested_at) as staleness
  FROM analytics.fact_events
  GROUP BY source_topic
  ORDER BY staleness DESC;
"

# Verify cache hit ratio
curl -s http://analytics:3031/ops/metrics | grep analytics_cache_hit_ratio
```

**Verification after fix:**

```bash
# Dashboard shows fresh data
curl -s "http://analytics:3031/v1/analytics/dashboards/{id}" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.lastRefreshedAt'

# Cache operating normally
curl -s http://analytics:3031/ops/metrics | grep analytics_cache_hit_ratio
```

**Communication template:**

> 🔵 **[P3] Analytics — Dashboard data stale**  
> Dashboard {name} showing data from {timestamp}. Expected: near-real-time (< 60s).  
> Root cause: {cache TTL bug | upstream ingestion lag | Redis issue}.  
> No operational impact — analytics is informational. Decision-makers advised.  
> ETR: {immediate for cache flush | depends on upstream for ingestion issues}.

---

## Rollback

```bash
# Docker
docker pull civitasone/analytics-service:$PREVIOUS_TAG
docker-compose -f infra/docker-compose.prod.yml up -d analytics-service analytics-worker

# K8s
kubectl set image deployment/analytics-service \
  analytics=civitasone/analytics-service:$PREVIOUS_TAG -n civitasone
kubectl set image deployment/analytics-worker \
  worker=civitasone/analytics-service:$PREVIOUS_TAG -n civitasone

# Verify health post-rollback
curl -s http://analytics:3031/health | jq .

# Verify consumers reconnected
curl -s http://analytics:3031/ops/consumer-status | jq '.consumers | keys | length'

# Verify fact ingestion resumed
watch -n5 'curl -s http://analytics:3031/ops/metrics | grep analytics_facts_ingested_total'
```

**Note:** Fact tables are append-only projections. They can be rebuilt from source events if corrupted (expensive — coordinate with SRE). Rollback does not affect stored facts.

---

## Recovery (RPO/RTO)

**RPO:** ≤ 15 min (continuous WAL archiving) | **RTO:** 30 min

```bash
# 1. Restore DB
./scripts/ops/restore-database.sh analytics --target-time="2026-07-26T02:00:00Z"

# 2. Identify gap window
psql civitas_analytics -c "
  SELECT source_topic, MAX(ingested_at) as last_fact
  FROM analytics.fact_events
  GROUP BY source_topic;
"

# 3. Request event replay from source services (for gap period)
# NOTE: Source services must replay from their outbox tables
# Coordinate with: finance, procurement, court, meeting, visitor teams
echo "Gap window: 2026-07-26T01:45:00Z to $(date -Iseconds)"
echo "Source services to contact: finance, procurement, grants, meeting, court, visitor"

# 4. Replay own outbox (for downstream analytics events)
curl -X POST http://analytics:3031/ops/outbox-relay/replay-pending

# 5. Verify fact table coverage (check for missing hours)
psql civitas_analytics -c "
  SELECT source_topic, date_trunc('hour', ingested_at) as hour, COUNT(*)
  FROM analytics.fact_events
  WHERE ingested_at > '2026-07-25T00:00:00Z'
  GROUP BY source_topic, hour
  ORDER BY source_topic, hour;
"

# 6. Flush all dashboard caches (force fresh queries)
redis-cli -p 6381 KEYS "analytics:*:dashboard:*" | xargs -r redis-cli -p 6381 DEL

# 7. Verify query engine healthy
curl -s http://analytics:3031/ops/metrics | grep analytics_query_success
```

**Post-recovery communication:**

> ✅ **[RESOLVED] Analytics service restored**  
> DB restored to {timestamp}. Fact tables have a gap from {start} to {end}.  
> Event replay requested from {N} source services.  
> Dashboard caches flushed — fresh data displaying.  
> Gap indicator shown on affected dashboards until replay completes.
