# Runbook: project-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, p95 read < 400 ms.

- **Purpose:** government scheme/project management — project creation with scheme linkage, task management, milestone tracking, fund-release lifecycle (with allocation ceiling enforcement), DPR (Detailed Project Report) submission, utilisation certificate (UC) submission with expenditure validation, geo-tagging of project sites (photo evidence), physical/financial progress recording, delay forecasting (ml-service integration), and board-intake for meeting-service decisions. Owns `civitas_project`.

- **Owner / escalation:** primary: Project/Scheme Domain Owner. Secondary: SRE. Page on fund-release failures (government scheme money flow at stake) or UC expenditure-exceeded alerts.

- **Dependencies:**
  - Own Postgres DB (`civitas_project`), RLS enabled, tenant-scoped.
  - Redis — read-through cache for project status, milestone progress, fund-release balances.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for project CRUD, task lifecycle, milestone create/complete, scheme create/component, fund-release create/disburse, physical/financial progress, DPR submit, UC submit, geo-tag, photo upload; events for all mutations + allocation-exceeded/UC-expenditure-exceeded alerts.
  - Cross-service consumed: `ml.prediction.task_high_risk` (delay risk score > 0.80 triggers proactive intervention), `meeting.decision.project` (board/committee decisions on project approvals — creates triage intake).
  - Cross-service produces: `project.milestone.completed` (consumed by grant-service for UC gate release), `project.fund_release.approved` / `disbursed` (consumed by finance for GL posting).
  - Financial integrity: fund-release amounts validated against scheme allocation ceilings; UC expenditure validated against released amounts. Both use BigInt paise.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: schemes by status, fund utilization rate, physical vs financial progress gap, milestone completion rate, delay-risk distribution (from ml-service), geo-tag coverage.
  - Alert: fund-release exceeds allocation = CRITICAL (auto-rejected by domain logic, but investigate why it was attempted); UC expenditure exceeds release = WARN (data quality issue); delay-risk high for > 20% of tasks = WARN.

- **Common failure modes → action:**
  - *Fund-release blocked (allocation exceeded)* → this is correct domain behavior — the release amount exceeds the scheme component's budget allocation. Verify the allocation was set correctly; if the scheme received additional budget, update the allocation first.
  - *UC submission rejected (expenditure exceeds)* → the utilisation certificate's reported expenditure is greater than the total funds released. This is a data-entry error — the UC must be corrected. Not a system failure.
  - *Board-intake triage items piling up* → `meeting.decision.project` events from meeting-service create triage items for project officers to action. If no one is actioning them, it's a process issue. If the consumer is failing, check DLQ.
  - *Geo-tag upload failing* → geo-tags include GPS coordinates + photos stored in S3/MinIO. If S3 is unreachable, the upload will fail. Check storage connectivity. Photos are stored via the `@civitasone/storage` adapter.
  - *Milestone completion not triggering grant release* → verify the `project.milestone.completed` event was published and reached grant-service. The grant disbursement is conditional on milestone completion — if the event was lost, the grant stays blocked.
  - *Delay forecast not updating* → ml-service computes delay risk. If predictions stop arriving, tasks retain their last-known risk score. Non-blocking, but investigate ml-service health if it persists > 24h.

- **Rollback:** redeploy previous image tag. Fund-release records are append-only (never delete a disbursement). Scheme allocations can be increased but not decreased below utilised amount.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) reconcile fund-release totals against finance-service GL entries; (2) verify milestone-to-grant linkage is intact; (3) re-compute scheme utilization percentages from transaction history.
