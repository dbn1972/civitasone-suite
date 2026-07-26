# Runbook: report-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, report generation p95 < 30s (complex reports may take longer — async with notification on completion).

- **Purpose:** report generation engine — template management (create/update/delete with parameterized queries), job execution (on-demand + scheduled), PDF/Excel/CSV rendering via `@civitasone/render`, scheduled report delivery (email/webhook), MIS (Management Information System) reports, KPI definitions, and dashboard widgets. Owns `civitas_report`. 7 modules. Cross-cutting — generates reports from data across all domain services via their read APIs.

- **Owner / escalation:** primary: Data/Reporting Domain Owner. Secondary: SRE.

- **Dependencies:**
  - Own Postgres DB (`civitas_report`), RLS enabled, tenant-scoped. Stores templates, job metadata, schedule definitions, rendered outputs.
  - Redis — job status cache, template cache, rate limiting for on-demand generation.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for job create/render, template CRUD/execute, scheduled generate; events for job created/completed/failed, template lifecycle, scheduled generated/delivered/failed.
  - `@civitasone/render` — PDF generation (with DSC signing capability), Excel/CSV export.
  - Storage: rendered reports stored in S3/MinIO (tenant-scoped, time-limited download URLs).
  - Cross-service reads: report templates contain parameterized queries that fetch data from other services' read APIs (via gateway). Report-service is a consumer of all services' data but never writes to them.
  - Notification-service: delivery of completed scheduled reports.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: report generation rate, generation time distribution (p50/p95/p99), scheduled delivery success rate, template execution count, storage usage.
  - Alert: scheduled report delivery failure = WARN; report generation timeout (> 60s) = WARN; storage quota approaching limit = WARN.

- **Common failure modes → action:**
  - *Report generation timing out* → complex reports querying large datasets can timeout. Check the template's query parameters — the date range may be too wide. Add pagination or reduce the scope. For very large reports (> 100K rows), suggest streaming/CSV export instead of PDF.
  - *Scheduled delivery failing* → scheduled reports are generated and then delivered (email/webhook). If generation succeeds but delivery fails, check notification-service health (for email) or the webhook endpoint (for webhook delivery).
  - *Template execution error* → templates reference data from other services. If a service's API contract changed (new required parameter, renamed field), the template's query will break. Check the template's data-source configuration against the current API spec.
  - *PDF rendering OOM* → very large PDFs (hundreds of pages, many charts) can exhaust memory. The render package has a configurable memory limit. For large reports, split into multiple PDFs or use CSV/Excel format.
  - *Storage filling up* → rendered reports accumulate. Implement/verify the retention policy (delete rendered outputs older than configured days). Check S3 lifecycle rules.
  - *Concurrent generation overload* → too many on-demand report requests can overload the service. Rate limiting (via Redis) should throttle; if it's not working, check Redis connectivity. Encourage users to schedule reports for off-peak hours.

- **Rollback:** redeploy previous image tag. Templates are versioned (rollback doesn't delete template definitions). Rendered outputs in S3 are immutable (new renders create new files).

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) rendered reports in S3 are not affected (stored outside DB); (2) re-trigger any scheduled reports that were due during the outage; (3) job status for in-flight reports at the time of failure should be marked as `failed` (the render didn't complete).
