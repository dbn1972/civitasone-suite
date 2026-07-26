# Runbook: analytics-service

> Tier 2. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, query execution p95 < 5s, fact ingestion lag < 60s.

- **Purpose:** cross-domain analytics engine — ingests domain events from all services into a unified fact store, provides ad-hoc query execution, saved metrics/KPI definitions, dashboard composition (widgets), scheduled report exports, and tenant-scoped data sharing. Owns `civitas_analytics`. Read-heavy, eventually consistent projection of the entire platform's business events.

- **Owner / escalation:** primary: Data/Analytics Domain Owner. Secondary: SRE. Page on fact ingestion lag > 5 minutes (dashboards become stale — decision-makers lose trust).

- **Dependencies:**
  - Own Postgres DB (`civitas_analytics`), RLS enabled, tenant-scoped. Stores the materialized fact tables (denormalized projections of cross-service events).
  - Redis — query result cache (short TTL: 60s for dashboards, 5min for scheduled exports).
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for query run, scheduled query creation, exports, dashboard CRUD, widget management, metric definitions; events for query completion/failure, dashboard/widget lifecycle.
  - **Inbound event consumers** (highest-volume inbound fan-in): `finance.payment.released`, `grants.release.processed`, `procurement.po.approved`, `meeting.attendance.marked`, `meeting.vote.concluded`, `meeting.meeting.completed`, `court.case.registered`, `court.case.status_changed`, `court.hearing.scheduled`, `visitor.checked_in`, `visitor.overstay.alerted`.
  - No external integrations — purely internal projection service.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: fact ingestion rate (events/sec), ingestion lag (time from event publish to fact materialization), query execution p50/p95/p99, cache hit ratio, export job success rate, dashboard render time.
  - Alert: ingestion lag > 60s = WARN, > 5min = CRITICAL; query failure rate > 5% = WARN; export job timeout > 2/day = investigate.

- **Common failure modes → action:**
  - *Fact ingestion lag increasing* → check consumer throughput; the analytics worker processes events from 12+ inbound topics. If one topic has a backlog, it can starve others. Verify per-topic consumer concurrency; scale the analytics worker horizontally if needed.
  - *Query execution timeout* → complex cross-domain queries can be expensive. Check `EXPLAIN ANALYZE` for the failed query; common issues: missing index on fact table partition key (tenant_id + time range), or query spans too large a time window. Add pagination or time-bound constraints.
  - *Dashboard widgets showing stale data* → verify the fact table for that domain is being updated. If `finance.payment.released` events stopped arriving, the issue is upstream (finance-service outbox relay, not analytics). Check the source service's health first.
  - *Scheduled export failing* → exports write to S3/MinIO. Check storage connectivity and bucket permissions. If the export dataset is very large (> 1M rows), it may timeout — suggest the user narrow the date range or add filters.
  - *DLQ on inbound events* → analytics consumers are tolerant of unknown fields (forward-compatible). DLQ entries usually indicate a fundamental schema change in the source event that breaks the fact materialization logic. Inspect the payload; if a new field was added, this is fine (consumer ignores unknown fields). If a required field was removed, coordinate with the source service team.
  - *Cache invalidation not working (stale query results)* → analytics uses short TTL caching (60s). If results are stale beyond that, verify Redis health. Note: analytics does NOT actively invalidate on write (unlike domain services) — it relies on TTL expiry. This is by design (eventual consistency acceptable for analytics).

- **Rollback:** redeploy previous image tag. Fact tables are append-only projections — they can be rebuilt from source events if corrupted (but this is expensive; avoid unless necessary).

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup. Fact tables may have gaps from the outage period — these will NOT self-heal (source events have already been consumed). To fill gaps: (1) identify the time window of data loss, (2) request a replay of source events from the affected services' outbox tables (requires coordination), or (3) accept the gap for non-critical analytics. Decision-maker dashboards should show a "data gap" indicator for the affected period.
