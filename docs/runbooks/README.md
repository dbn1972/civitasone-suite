# Operational Runbooks

This directory holds the per-service operational runbooks required by Charter §38.6 ("a
service is not production-ready unless it has SLOs, dashboards, alerts, a runbook,
ownership, and failure-testing evidence") and §28 (NFRs). Each runbook follows the
standard template defined in [`docs/operations/SLO-SLI-RUNBOOKS.md` §5](../operations/SLO-SLI-RUNBOOKS.md#5-standard-service-runbook-template-charter-384):
Purpose, Owner/escalation, Dependencies, Key dashboards, Common failure modes → action,
Rollback, and Recovery (RPO/RTO).

Coverage today is the 9 Tier-0/Tier-1 services — the ones whose outage constitutes a
full or partial platform outage per [§4 of the SLO/SLI doc](../operations/SLO-SLI-RUNBOOKS.md#4-customer-impact-thresholds-charter-385).
Tier-2/3 services do not yet have individual runbook files; §5 of the SLO/SLI doc
remains their interim runbook until one is split out (see [backlog item 5](../operations/SLO-SLI-RUNBOOKS.md#6-operational-maturity-backlog-to-reach-full-38-compliance)).

## Tier 0 — platform edge/bus (99.95% availability SLO)

| Service | Runbook | Purpose |
|---------|---------|---------|
| gateway | [`gateway.md`](./gateway.md) | Single external entry point — CORS/Helmet/rate-limit/quota, JWT edge verification, module-guard/ABAC, reverse proxy to all 33 upstreams. |
| identity | [`identity.md`](./identity.md) | Authentication/identity domain of record — sessions, MFA, RBAC, Keycloak-issued RS256 JWTs. |
| queue | [`queue.md`](./queue.md) | Message-bus front door bridging client-facing queue operations to the `@civitasone/queue` adapter (SQS/RabbitMQ). |

## Tier 1 — core domain services (99.9% availability SLO)

| Service | Runbook | Purpose |
|---------|---------|---------|
| finance | [`finance.md`](./finance.md) | Double-entry GL, budget/sanction/bill/payment lifecycle, treasury, GST/TDS, PFMS/e-Kuber and TRACES integration. |
| estab | [`estab.md`](./estab.md) | eOffice file/noting lifecycle, committee/meeting management, RTI, records retention, facilities booking. |
| workflow | [`workflow.md`](./workflow.md) | Cross-service approval/maker-checker orchestration and task dispatch. |
| hrms | [`hrms.md`](./hrms.md) | Employee lifecycle, recruitment, appraisal, medical claims, pension, geo-attendance, workforce planning. |
| payroll | [`payroll.md`](./payroll.md) | Payroll structure/run compute/approve/disburse, loans, tax declarations, F&F settlement, pensioner computation. |
| audit | [`audit.md`](./audit.md) | Platform-wide audit event ingestion, audit plan/observation/para lifecycle, CERT-In structured-audit-log backbone. |

## Tier 2/3 services

Tier-2/3 services (all others in the 33-service fleet) are covered by the shared
template in [`SLO-SLI-RUNBOOKS.md` §5](../operations/SLO-SLI-RUNBOOKS.md#5-standard-service-runbook-template-charter-384)
rather than an individual file in this directory. When a Tier-2 service is promoted
or otherwise needs its own runbook, copy that §5 template — the same structure used
by the 9 files above — into a new `docs/runbooks/<service>.md`, fill in the
service-specific dependencies/dashboards/failure modes, and link it from this index.

## DR restore drill reports (Drill_Report retrieval)

The `Drill_Scheduler` GitHub Actions workflow ([`.github/workflows/dr-drill.yml`](../../.github/workflows/dr-drill.yml))
runs weekly (Sunday 03:00 UTC, plus on-demand via `workflow_dispatch`) to prove backups are
actually restorable within the RPO/RTO targets in [SLO-SLI-RUNBOOKS.md §1](../operations/SLO-SLI-RUNBOOKS.md#1-platform-wide-slo-targets-charter-28).
It backs up all 33 service databases (`scripts/ops/backup-databases.sh`), restores each
Tier-0/Tier-1 backup into a scratch database and verifies table counts + a sample-row check
(`scripts/ops/restore-drill.sh --all-tier01`), and produces a `Drill_Report` JSON (run
timestamp, per-service pass/fail outcome, table counts, sample-row results).

For audit review, that `Drill_Report` history is retrievable from two locations:

1. **GitHub Actions artifacts** — every workflow run uploads `drill-report.json` as an
   artifact named `dr-drill-report-<run-id>`, retained for **400 days**. Browse
   [Actions → DR Restore Drill](../../.github/workflows/dr-drill.yml) in the repository, open
   the run in question, and download the artifact from its summary page.
2. **Durable object storage** — `scripts/ops/publish-drill-report.mjs` persists the same
   (credential-redacted) report to the `civitasone` S3/MinIO bucket's `dr-drills/` prefix
   (key: `dr-drills/<compact-run-timestamp>.json`), and emits an Audit_Event recording the
   drill outcome via the audit-service's outbox-fed ingestion path. This is the
   longer-lived, non-expiring copy — use it when a drill run is older than the 400-day
   artifact retention window, or when correlating against the audit trail.

On any Tier-0/Tier-1 drill failure, `scripts/ops/notify-alert-channel.mjs` pages the platform's
existing alerting channel (Slack webhook or Alertmanager, per `infra/observability/alertmanager.yml`).
