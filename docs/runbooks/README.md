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
