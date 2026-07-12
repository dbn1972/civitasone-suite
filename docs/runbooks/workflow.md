# Runbook: workflow-service

> Tier 1. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, p95 read < 400 ms, task dispatch < 10s (see §3).

- **Purpose:** cross-service approval/maker-checker orchestration engine — workflow instance lifecycle (create/complete task/cancel/suspend/resume), message correlation, and signal broadcast. Dispatches approved-task completions as commands into the owning service (leave approve, payroll run approve, indent/PO approve, estab file approve/reject, asset dispose approve). Enforces separation of duties (SoD) platform-wide.

- **Owner / escalation:** primary: Workflow domain owner. Secondary: SRE. Page on task-dispatch latency > 10s sustained — every downstream approval (finance, HR, procurement, estab, asset) blocks on this service's dispatch.

- **Dependencies:**
  - Own Postgres DB (`civitas_workflow`), RLS enabled.
  - Redis — read-through cache for instance/task queries.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands `workflow.instance.create/cancel/suspend/resume`, `workflow.task.complete`, `workflow.message.deliver/correlate`, `workflow.signal.broadcast`; events `workflow.instance.created/cancelled/rejected/suspended/resumed`, `workflow.task.completed/assigned`, `workflow.message.delivered/received/timeout`, `workflow.signal.delivered/received`.
  - **Cross-service `DISPATCH` map** — the highest-fan-out dependency: `hrms.leave.approve`, `payroll.run.approve`, `procurement.indent.approve`, `procurement.po.approve`, `estab.file.approve/reject/level_approved`, `asset.dispose.approve`. A workflow-service outage stalls approvals across all six of these domains simultaneously — treat as a cross-domain partial outage, not a single-service issue.
  - Consumed cross-service events: `tenant.tenant.created` (tenant-service) — provisions default workflow definitions for new tenants.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay failures) via `registerOpsRoutes`.
  - Grafana: p95 read latency (400ms target), task-dispatch latency (10s target), overdue-task count (per the platform metrics standard), active workflow instance count.

- **Common failure modes → action:**
  - *Consumer stalled* (heartbeat stale on `workflow-worker`) → restart worker; inspect last message on `workflow.task.complete`; check DB connectivity. This is higher-urgency than a typical Tier-1 stall because it blocks six downstream domains' approval queues.
  - *DLQ filling on `workflow.instance.create` or `workflow.task.complete`* → read DLQ `error`; poison (validation) → fix upstream producer (likely a malformed instance-create from the initiating service); transient → redrive after dependency recovers.
  - *Task dispatch not reaching the target service* (e.g. `hrms.leave.approve` never lands) → check the `DISPATCH` map wiring and the outbox relay for the dispatch command topic; confirm the target service's consumer is itself healthy (cross-check that service's own runbook).
  - *Outbox relay failing* → check DB + SQS reachability; relay is idempotent, safe to resume.
  - *Overdue-task count climbing* → check for a stalled task-assignment step (e.g. approver roster misconfigured) rather than assuming an infra issue; this is a business-process signal as much as a technical one.
  - *p95 read latency high* → check Redis hit rate on instance/task queries, DB slow queries on large multi-step workflow definitions.

- **Rollback:** redeploy previous image tag; migrations are forward-only — never auto-rollback schema.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox; verify audit continuity for every task completion/approval since the last backup, and re-verify the `DISPATCH` map delivered every pending approval command to its six downstream consumers before declaring recovery complete.
