# Operational Runbooks

This directory holds the per-service operational runbooks required by Charter §38.6 ("a
service is not production-ready unless it has SLOs, dashboards, alerts, a runbook,
ownership, and failure-testing evidence") and §28 (NFRs). Each runbook follows the
standard template defined in [`docs/operations/SLO-SLI-RUNBOOKS.md` §5](../operations/SLO-SLI-RUNBOOKS.md#5-standard-service-runbook-template-charter-384):
Purpose, Owner/escalation, Dependencies, Key dashboards, Common failure modes → action,
Rollback, and Recovery (RPO/RTO).

**Coverage: 100% — all 41 services have dedicated runbooks.**

---

## Tier 0 — Platform Edge/Bus (99.95% availability SLO)

| Service | Runbook | Purpose |
|---------|---------|---------|
| gateway | [`gateway.md`](./gateway.md) | Single external entry point — CORS/Helmet/rate-limit/quota, JWT edge verification, module-guard/ABAC, reverse proxy to all upstreams. |
| identity | [`identity.md`](./identity.md) | Authentication/identity domain of record — sessions, MFA, RBAC, Keycloak-issued RS256 JWTs. |
| queue | [`queue.md`](./queue.md) | Message-bus front door bridging client-facing queue operations to the `@civitasone/queue` adapter (SQS/RabbitMQ). |

## Tier 1 — Core Domain Services (99.9% availability SLO)

| Service | Runbook | Purpose |
|---------|---------|---------|
| finance | [`finance.md`](./finance.md) | Double-entry GL, budget/sanction/bill/payment lifecycle, treasury, GST/TDS, PFMS/e-Kuber integration. |
| estab | [`estab.md`](./estab.md) | eOffice file/noting lifecycle, committee/meeting management, RTI, records retention, facilities. |
| workflow | [`workflow.md`](./workflow.md) | Cross-service approval/maker-checker orchestration and task dispatch. |
| hrms | [`hrms.md`](./hrms.md) | Employee lifecycle, recruitment, appraisal, medical claims, pension, geo-attendance, workforce planning. |
| payroll | [`payroll.md`](./payroll.md) | Payroll structure/run compute/approve/disburse, loans, tax, F&F, pensioner computation. |
| audit | [`audit.md`](./audit.md) | Platform-wide audit event ingestion, audit plan/observation/para lifecycle, CERT-In backbone. |

## Tier 2 — Business-Critical Domain Services (99.9% availability SLO)

| Service | Runbook | Purpose |
|---------|---------|---------|
| citizen | [`citizen.md`](./citizen.md) | Public-facing citizen portal — grievances (CPGRAMS), RTI, applications, fee payments, SLA enforcement. |
| notification | [`notification.md`](./notification.md) | Multi-channel delivery (email/SMS/push/webhook), templates, scheduling, campaigns, DND. |
| billing | [`billing.md`](./billing.md) | SaaS subscription lifecycle, invoicing, Razorpay payments, e-invoicing, dunning, revenue recognition. |
| procurement | [`procurement.md`](./procurement.md) | Procure-to-pay lifecycle — indent, tender, PO, GRN, 3-way match, vendor management, EMD/PBG. |
| contract | [`contract.md`](./contract.md) | Contract lifecycle — templates, approvals, amendments, obligations, renewals, e-signature. |
| visitor | [`visitor.md`](./visitor.md) | Premises security — visit requests, passes, check-in/out, blacklist, evacuation, material/vehicle passes. |
| meeting | [`meeting.md`](./meeting.md) | Committee/board governance — scheduling, quorum, attendance, voting, decisions, minutes, actions. |
| grant | [`grant.md`](./grant.md) | Grant/subsidy management — schemes, applications, disbursement, UC gate, PFMS reconciliation. |
| policy | [`policy.md`](./policy.md) | RBAC/ABAC policy engine — evaluation on every request, binding management, break-glass. |
| admin | [`admin.md`](./admin.md) | Platform control plane — tenant management, feature flags, webhooks, scheduled jobs, break-glass. |
| install | [`install.md`](./install.md) | Installation orchestration — DAG wizard, DB provisioning, readiness scoring. |
| legal | [`legal.md`](./legal.md) | Legal case management — cases, hearings, notices, opinions, limitation tracking, e-Courts. |
| court | [`court.md`](./court.md) | Court/tribunal management — case registry, hearings, cause-list, filings, orders, appeals. |

## Tier 3 — Supporting Services (99.5% availability SLO)

| Service | Runbook | Purpose |
|---------|---------|---------|
| analytics | [`analytics.md`](./analytics.md) | Cross-domain analytics — fact ingestion, ad-hoc queries, dashboards, scheduled exports. |
| crm | [`crm.md`](./crm.md) | Stakeholder relationship management — contacts, deals, pipelines, lead scoring. |
| helpdesk | [`helpdesk.md`](./helpdesk.md) | Internal helpdesk — tickets, SLA engine, service catalogue, automation, CMDB. |
| project | [`project.md`](./project.md) | Scheme/project management — fund releases, milestones, UC tracking, geo-tagging, delay forecast. |
| inventory | [`inventory.md`](./inventory.md) | Store/inventory management — items, receipts, issues, transfers, cycle-count, batch tracking. |
| stock | [`stock.md`](./stock.md) | Stock register and e-way bill management — entries, physical verification, GST e-way bill. |
| asset | [`asset.md`](./asset.md) | Fixed asset lifecycle — register, depreciation, maintenance, disposal/condemnation, insurance. |
| location | [`location.md`](./location.md) | Geographic/hierarchy management — locations, org hierarchy, geofence, jurisdiction, pincode. |
| knowledge | [`knowledge.md`](./knowledge.md) | Knowledge base — documents, categories, search, versions, retention, AI assistant. |
| telephony | [`telephony.md`](./telephony.md) | Call center management — call lifecycle, agent routing, queues, IVR, transcription. |
| report | [`report.md`](./report.md) | Report generation engine — templates, scheduled/on-demand rendering, PDF/Excel delivery. |
| tenant | [`tenant.md`](./tenant.md) | Tenant registry — plans, subscriptions, org-hierarchy, quotas, isolation mode. |
| plugin | [`plugin.md`](./plugin.md) | Plugin/extension ecosystem — registry, sandboxed execution, hooks, marketplace. |
| theme | [`theme.md`](./theme.md) | Branding/theming — design tokens, tenant branding, email/PDF template themes. |
| inspection | [`inspection.md`](./inspection.md) | Regulatory inspection — universe, risk-based planning, offline execution, findings, CAPA. |
| works | [`works.md`](./works.md) | Public works/infrastructure — proposals, tenders, BoQ, execution, billing, asset handover. |
| revenue | [`revenue.md`](./revenue.md) | Municipal revenue — rate engine, assessments, demand generation, collections, arrears. |
| metadata | [`metadata.md`](./metadata.md) | Custom object engine — tenant-defined entities and rules (early stage). |
| ml | [`ml.md`](./ml.md) | ML/AI infrastructure — feature store, model registry, training, inference (advisory only). |

---

## Runbook Template Structure

Every runbook follows this structure (per `docs/operations/SLO-SLI-RUNBOOKS.md` §5):

1. **Header** — Tier classification, SLO targets
2. **Purpose** — What the service does, which database it owns, key domain context
3. **Owner / escalation** — Primary and secondary contacts, paging criteria
4. **Dependencies** — Database, cache, queue topics, cross-service integrations, external systems
5. **Key dashboards** — Where to look first during an incident
6. **Common failure modes → action** — The operational playbook (if X → do Y)
7. **Rollback** — How to safely revert a bad deploy for this specific service
8. **Recovery (RPO/RTO)** — How to restore from backup and what to verify after

---

## DR Restore Drill Reports

The `Drill_Scheduler` GitHub Actions workflow ([`.github/workflows/dr-drill.yml`](../../.github/workflows/dr-drill.yml))
runs weekly (Sunday 03:00 UTC, plus on-demand via `workflow_dispatch`) to prove backups are
actually restorable within the RPO/RTO targets.

Drill reports are retrievable from:
1. **GitHub Actions artifacts** — `dr-drill-report-<run-id>`, retained for 400 days.
2. **Durable object storage** — `dr-drills/<timestamp>.json` in S3/MinIO bucket, non-expiring.

On any Tier-0/Tier-1 drill failure, `scripts/ops/notify-alert-channel.mjs` pages the platform's
alerting channel (Slack/Alertmanager).

---

## Cross-Cutting Operational Principles

These apply to ALL services and are not repeated in each runbook:

- **Idempotency**: every consumer calls `markProcessed(tx, msg.messageId)` first. Safe to redrive.
- **RLS**: every service sets `app.tenant_id` GUC per request. Cross-tenant access = impossible.
- **Outbox relay**: if the outbox relay is stalled, events stop propagating. Check DB + SQS connectivity.
- **Health check**: every service exposes `/health` (liveness) and `/ready` (includes DB/Redis/queue checks).
- **Correlation ID**: every request carries `x-correlation-id` through the entire chain. Use it to trace cross-service flows.
- **Structured logging**: Pino JSON. Filter by `correlationId`, `tenantId`, `reqId`, `messageId` for incident investigation.
- **Cache pattern**: all reads go through `cache.getOrLoad()`. If Redis is down, services fall through to DB (WARN, not ERROR).
- **Graceful shutdown**: SIGTERM → drain in-flight requests → stop consumers → close DB pool → exit. Safe for rolling deploys.
