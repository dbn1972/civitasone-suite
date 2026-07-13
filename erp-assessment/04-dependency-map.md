# 04 — Dependency Map & Knowledge Graph

**Lane:** L02 · Cross-Module Integration  
**Generated:** 2026-07-12  
**Evidence base:** grep of `services/*/src/topics.ts` (all 38 services on `court-management-service` branch), `packages/events/src/index.ts`, `packages/eoffice-sdk/src/contracts.ts`, `services/gateway-service/src/registry.ts`, `services/*/src/modules/*/schema.ts` (pgSchema.table calls), all consumer files, and cross-service HTTP client files. All findings are from executed code paths; no README/comment trust.

---

## 1. API Gateway Routing Map

`gateway-service/src/registry.ts` registers 44 route entries spanning 37 upstream services (some services get dual prefixes for backwards compatibility). Gateway resolves longest-prefix-first.

| Route Prefix(es) | Upstream Service | Port |
|---|---|---|
| `/api/identity` | identity-service | 3001 |
| `/api/v1/admin/users`, `/api/v1/sync`, `/api/v1/devices` | identity-service (alias) | 3001 |
| `/api/v1/tenants` | tenant-service | 3002 |
| `/api/policy`, `/api/v1/policy` | policy-service | 3003 |
| `/api/audit`, `/api/v1/audit` | audit-service | 3004 |
| `/api/v1/install` | install-service | 3005 |
| `/api/notification` | notification-service | 3006 |
| `/api/v1/finance` | finance-service | 3007 |
| `/api/v1/procurement` | procurement-service | 3008 |
| `/api/v1/contract` | contract-service | 3009 |
| `/api/v1/estab`, `/api/v1/establishment` | estab-service | 3010 |
| `/api/v1/stock` | stock-service | 3011 |
| `/api/v1/hrms`, `/api/v1/hr`, `/api/v1/careers` | hrms-service | 3012 |
| `/api/v1/payroll` | payroll-service | 3013 |
| `/api/v1/project`, `/api/v1/projects` | project-service | 3014 |
| `/api/v1/asset`, `/api/v1/assets` | asset-service | 3015 |
| `/api/v1/reports` | report-service | 3016 |
| `/api/v1/plugins` | plugin-service | 3017 |
| `/api/v1/themes` | theme-service | 3018 |
| `/api/v1/grants`, `/api/v1/grant` | grant-service | 3019 |
| `/api/v1/citizen` | citizen-service | 3020 |
| `/api/v1/legal` | legal-service | 3021 |
| `/api/v1/admin` | admin-service | 3022 |
| `/api/v1/billing` | billing-service | 3023 |
| `/api/v1/crm` | crm-service | 3024 |
| `/api/v1/inventory` | inventory-service | 3025 |
| `/api/v1/telephony` | telephony-service | 3026 |
| `/api/v1/helpdesk` | helpdesk-service | 3027 |
| `/api/v1/knowledge` | knowledge-service | 3028 |
| `/api/v1/workflow` | workflow-service | 3029 |
| `/api/v1/queue` | queue-service | 3030 |
| `/api/v1/analytics` | analytics-service | 3031 |
| `/api/v1/ml` | ml-service | 3032 |
| `/api/v1/meeting` | meeting-service | 3033 |
| `/api/v1/court`, `/api/v1/courts` | court-service | 3034 |
| `/api/v1/visitor` | visitor-service | 3035 |
| `/api/v1/locations` | location-service | 4012 |

**⚠ GAP: `metadata-service` has no gateway route and no assigned port.** The service exists with 5 schema tables (`entity_definitions`, `field_definitions`, `custom_records`, `layout_definitions`, `validation_rules`) and is confirmed a stub. Its APIs are unreachable from outside.

---

## 2. DB Ownership Map

Each service uses a `pgSchema("<name>")` namespace inside a single shared Postgres 16 cluster. No cross-schema JOINs are present in application code (verified by grepping for cross-schema Drizzle imports). **543 tables** total across 36 data services.

| Service | PG Schema(s) | Table Count | Notable Tables |
|---|---|---|---|
| admin-service | `api_keys,backup,config,custom_domains,data_export,feature_flags,health,scheduled_jobs,support,tenants,webhooks` | 17 | admin_tenants, admin_feature_flags, scheduled_jobs, webhooks, admin_break_glass_log |
| analytics-service | `analytics` | 9 | fact_events, dashboards, query_runs, export_jobs |
| asset-service | `depreciation,enterprise,insurance,lifecycle,maintenance,register` | 21 | asset_assets, asset_dep_schedules, asset_disposals, asset_work_orders |
| audit-service | `compliance,events,exports,investigation,observation,para,plan,risk,vigilance` | 17 | audit_plans, audit_observations, audit_paras, events, investigations |
| billing-service | `einvoice,invoices,payments,plans,revenue,subscriptions,usage` | 14 | billing_subscriptions, billing_invoices, billing_payments, revenue_ledger |
| citizen-service | `analytics,application,citizen,grievance,helpdesk,portal,rti` | 18 | citizen_profiles, citizen_applications, citizen_grievances, citizen_rti_requests |
| contract-service | `approvals,clauses,contracts,esign,obligations,rate,renewals,templates,versions` | 15 | contract_contracts, clause_library, contract_obligations, esign_routes |
| court-service | `court` | 22 | cases, hearings, orders, notices, evidence, cause_lists, compliance_directions, appeals, case_parties, certified_copies |
| crm-service | `crm` | 7 | contacts, deals, pipelines, activities |
| estab-service | `assets,committee,facilities,files,legal` | 42 | estab_files, estab_notings, estab_committees, estab_court_cases, estab_rti_requests |
| finance-service | `audit,budget,gl,org,payments,simplified,treasury` | 39 | finance_budgets, finance_journals, finance_payments, finance_sanctions, transactions |
| grant-service | `application,beneficiary,disbursement,scheme,utilisation` | 16 | grant_schemes, grant_applications, grant_disbursements, grant_uc_statements |
| helpdesk-service | `helpdesk` | 5 | tickets, sla_policies, csat_responses |
| hrms-service | `appraisal,attendance,claims,disciplinary,employee,gpf,leave,lifecycle,medical,pension,recruitment,reservation,scheduler,training` | 50 | hrms_employees, hrms_leave_apps, hrms_attendance, hrms_pension_records |
| identity-service | `apikeys,breakglass,devices,mfa,rbac,sessions,sync,users` | 16 | users, sessions, roles, permissions, api_keys |
| install-service | `install,orchestrator` | 5 | wizard_definitions, stages, step_executions |
| inventory-service | `inventory` | 15 | items, warehouses, movements, stock_balances, three_way_matches |
| knowledge-service | `knowledge` | 6 | documents, categories, document_versions, retention_policies |
| legal-service | `cases,contracts,counsel,documents,filings,hearings,limitations,notices,opinions,reminders,settlements` | 20 | legal_cases, legal_hearings, legal_opinions, legal_notices, legal_settlements |
| location-service | `geofence,hierarchy,jurisdiction,location,pincode` | 5 | locations, administrative_units, geofences, jurisdictions, pincodes |
| meeting-service | `meeting` | 24 | meetings, committees, agenda_items, decisions, minutes, votes, action_items |
| metadata-service | `metadata` | 5 (stub) | entity_definitions, field_definitions, custom_records |
| ml-service | `ml` | 5 | ml_models, ml_predictions, ml_feature_vectors, ml_training_runs |
| notification-service | `alerts,bulk,channels,deliveries,stream,templates` | 10 | notifications, deliveries, templates, channels, campaigns |
| payroll-service | `loans,payroll,statutory` | 28 | payroll_runs, payroll_slips, payroll_loans, payroll_tds |
| plugin-service | `hooks,plugin,registry,sandbox,store` | 5 | plugins, plugin_hooks, plugin_stores |
| policy-service | `abac,bindings,role_features,roles` | 6 | roles, bindings, permissions, rules |
| procurement-service | `auction,grn,indent,payments,po,procurement,rfq,security,tender,vendor` | 24 | procurement_pos, procurement_grns, procurement_vendors, procurement_tenders |
| project-service | `geo,progress,project,scheme,utilisation` | 17 | project_projects, project_milestones, project_tasks, project_dprs |
| report-service | `reports` | 4 | report_templates, jobs, scheduled_reports |
| stock-service | `entry,eway_bill,item,ledger,valuation,warehouse` | 11 | stock_items, stock_warehouses, stock_entries, stock_ledger |
| telephony-service | `telephony` | 7 | calls, queues, agents, recordings, transcripts |
| tenant-service | `plans,quotas,settings,subscriptions,tenant` | 6 | tenants, plans, subscriptions, quotas |
| theme-service | `branding,templates,theme` | 5 | tenant_branding, tokens, templates |
| visitor-service | `visitor` | 28 | visit_requests, check_ins, blacklist_entries, devices, passage_events |
| workflow-service | `workflow` | 15 | definitions, instances, tasks, message_subscriptions, decision_tables |

**No shared-DB coupling found.** Zero evidence of cross-schema JOINs or cross-service credential grants in any service's application code. Each PG schema is an isolated namespace accessible only through its service's DB login.

---

## 3. Inter-Service Event Dependency Graph

### 3.1 Topic naming convention
```
{service}.{entity}.{action}
```
- **COMMANDS** — write intents (route → zod → queue.publish → 202 Accepted)
- **EVENTS** — domain facts (consumer → outbox → publish after DB write)
- **CONSUMED_EVENTS / CONSUMED / INBOUND** — what each service subscribes to from *other* services

### 3.2 eOffice (Estab) callback bus — packages/eoffice-sdk/src/contracts.ts

Services raise eFiled approvals via `EOfficeClient`; estab-service emits decision callbacks. All 15 ref_types are registered in `DECISION_CONSUMED_REF_TYPES` (fail-closed: unregistered types are rejected).

| ref_type | Callback Topic | Consuming Service |
|---|---|---|
| `finance_sanction` | `finance.sanction.file_decided` | finance |
| `finance_payment` | `finance.payment.file_decided` | finance |
| `finance_reappropriation` | `finance.reappropriation.file_decided` | finance |
| `procurement_po` | `procurement.po.file_decided` | procurement |
| `procurement_award` | `procurement.award.file_decided` | procurement |
| `hr_promotion` | `hrms.promotion.file_decided` | hrms |
| `hr_transfer` | `hrms.transfer.file_decided` | hrms |
| `hr_disciplinary` | `hrms.disciplinary.file_decided` | hrms |
| `hr_leave_special` | `hrms.leave_special.file_decided` | hrms |
| `hr_recruitment` | `hrms.recruitment.file_decided` | hrms |
| `grant_disbursement` | `grant.disbursement.file_decided` | grant |
| `grant_scheme` | `grant.scheme.file_decided` | grant |
| `asset_disposal` | `asset.disposal.file_decided` | asset |
| `legal_opinion` | `legal.opinion.file_decided` | legal |
| `contract_award` | `contract.award.file_decided` | contract |

### 3.3 Cross-service event consumption matrix (verified from topics.ts + consumers)

| Emitted Topic | Producer | Consumed By |
|---|---|---|
| `tenant.tenant.created` | tenant | hrms, meeting, workflow |
| `tenant.tenant.isolation_changed` | tenant | install |
| `tenant.deleted` | tenant | ml |
| `procurement.grn.accepted` | procurement | asset, finance, notification, inventory, stock |
| `finance.payment.made` | finance | grant, notification, payroll |
| `finance.sanction.approved` | finance | notification |
| `finance.bill.passed` | finance | notification |
| `finance.transaction.posted` | finance | ml |
| `audit.para.pending_recovery` | audit | finance |
| `audit.para.issued` | audit | notification |
| `payroll.run.approved` | payroll | finance |
| `grant.uc.submitted` | grant | finance |
| `legal.contract_review.cleared` | legal | procurement |
| `citizen.rti.filed` | citizen | estab |
| `estab.rti.responded` | estab | citizen |
| `hrms.employee.created` | hrms | payroll |
| `hrms.employee.separated` | hrms | payroll, meeting |
| `hrms.leave.approved` | hrms | notification, payroll |
| `hrms.leave.applied` | hrms | notification |
| `hrms.attendance.marked` | hrms | payroll |
| `project.milestone.completed` | project | grant |
| `project.task.updated` | project | ml |
| `crm.lead.updated` | crm | ml |
| `crm.lead.created` | crm | ml |
| `crm.case.opened` | crm | helpdesk |
| `helpdesk.ticket.created` | helpdesk | ml, notification |
| `helpdesk.ticket.updated` | helpdesk | ml |
| `helpdesk.ticket.escalated` | helpdesk | notification |
| `telephony.call.missed` | telephony | helpdesk |
| `billing.subscription.updated` | billing | ml |
| `inventory.receipt.posted` | inventory | ml |
| `inventory.issue.posted` | inventory | ml |
| `ml.prediction.lead_scored` | ml | crm |
| `ml.prediction.breach_risk_high` | ml | helpdesk, notification |
| `ml.prediction.anomaly_detected` | ml | finance |
| `ml.prediction.churn_risk_high` | ml | billing |
| `ml.prediction.stockout_risk` | ml | inventory |
| `ml.prediction.task_high_risk` | ml | project, notification |
| `meeting.decision.financial` | meeting | finance |
| `meeting.decision.procurement` | meeting | procurement |
| `meeting.decision.hr` | meeting | hrms |
| `meeting.decision.project` | meeting | project |
| `meeting.decision.legal` | meeting | legal |
| `meeting.attendance.marked` | meeting | analytics |
| `meeting.vote.concluded` | meeting | analytics |
| `meeting.meeting.completed` | meeting | analytics |
| `workflow.task.completed` | workflow | meeting, visitor |
| `workflow.task.assigned` | workflow | meeting |
| `workflow.instance.rejected` | workflow | visitor |
| `court.case.registered` | court | analytics |
| `court.case.status_changed` | court | analytics |
| `court.hearing.scheduled` | court | analytics |
| `procurement.po.approved` | procurement | analytics |
| `finance.payment.released` | (INBOUND claim) | analytics (BROKEN — never emitted; see BL-01) |
| `grants.release.processed` | (INBOUND claim) | analytics (BROKEN — never emitted; see BL-02) |
| `visitor.checked_in` | visitor | analytics |
| `visitor.overstay.alerted` | visitor | analytics |
| `visitor.security_incident.created` | visitor | notification |
| `visitor.scan.blacklist_match` | visitor | notification |
| `visitor.tailgating.detected` | visitor | notification |
| `visitor.anti_passback.violation` | visitor | notification |
| `visitor.emergency.unlock.triggered` | visitor | notification |
| `visitor.evacuation.declared` | visitor | visitor (self — triggers emergency unlock) |
| `notification.send` (command fwd) | court (OTP fire-and-forget) | notification |
| `finance.gl.post` (command) | inventory (cross-service command) | finance |
| `audit.event.record` (sink) | all services (262+ emit sites) | audit |

**Workflow approval dispatch (write-back commands on task completion):**

| Command Topic | Dispatched To |
|---|---|
| `hrms.leave.approve` | hrms |
| `payroll.run.approve` | payroll |
| `procurement.indent.approve` | procurement |
| `procurement.po.approve` | procurement |
| `estab.file.approve` / `estab.file.reject` | estab |
| `asset.dispose.approve` | asset |

---

## 4. Synchronous Cross-Service HTTP Coupling (outside queue)

These are **direct HTTP clients** where one service calls another over REST without going through the queue. Each represents a CQRS violation (reads from request path are acceptable; synchronous writes-on-request path are not per CLAUDE.md §6). All discovered via `*-client.ts` files and `process.env.*_SERVICE_URL` references.

| Caller | Callee | Client File | Purpose | CQRS Violation? | Circuit Breaker? |
|---|---|---|---|---|---|
| gateway-service | identity-service | `api-key-auth.ts` | API key validation on every request | No (auth gate — acceptable) | No |
| gateway-service | policy-service | `policy-check.ts` | Permission check on every request | No (auth gate — acceptable) | No |
| gateway-service | admin-service | `module-guard.ts` | Module toggle check | No (auth gate — acceptable) | No |
| gateway-service | tenant-service | `screen-manifest.ts` | Screen manifest fetch | No (read) | No |
| hrms-service | payroll-service | `shared/payroll-client.ts` | F&F route fetches tax breakdown from payroll | Partial (read from route; acceptable) | **YES** (CircuitBreaker 5 fails / 30s) |
| payroll-service | hrms-service | `shared/hrms-client.ts` | Payroll run / statutory exports fetch employee master | No (read) | No |
| helpdesk-service | asset-service | `modules/cmdb/asset-client.ts` | Ticket creation verifies asset reference | No (read, graceful degrade) | No |
| billing-service | ml-service | `modules/churn/adapter.ts` | Churn prediction request | **YES** (synchronous ML call from command path) | **YES** (CircuitBreaker) |
| helpdesk-service | ml-service | `modules/ml-breach/adapter.ts` | Breach risk prediction | **YES** (synchronous ML call from command path) | **YES** (CircuitBreaker) |
| inventory-service | ml-service | `modules/forecast/ml-client.ts` + consumer | Demand forecast fetch | **YES** (synchronous ML call) | No |
| crm-service | ml-service | `modules/leads/ml-scoring.ts` | Lead scoring request | **YES** (synchronous ML call from consumer path) | **YES** (CircuitBreaker) |
| project-service | ml-service | `modules/delay-forecast/adapter.ts` | Delay risk scoring | **YES** (synchronous ML call) | **YES** (CircuitBreaker) |
| billing-service | external NIC | `modules/einvoice/nic-client.ts` | e-Invoice generation | No (external integration) | — |
| billing-service | Razorpay / PayU | gateway adapters | Payment gateway | No (external integration) | — |
| finance-service | external PFMS | `modules/pfms/adapter.ts` | PFMS disbursement | No (external integration) | — |
| finance-service | external TRACES | `modules/traces/adapter.ts` | TDS reconciliation | No (external integration) | — |
| legal-service | external eCourts | `modules/ecourts/adapter.ts` | eCourts integration | No (external integration) | — |

**Bidirectional HTTP coupling: hrms ↔ payroll**  
Both services hold live HTTP clients to each other:
- hrms calls payroll for F&F tax breakdown (hrms `payroll-client.ts` → payroll port 3013)
- payroll calls hrms for employee master / payroll input (payroll `hrms-client.ts` → hrms port 3012)

This is not a circular event loop (the calls are on different business operations and do not feed back), but it creates a **mutual availability dependency**: an hrms-service restart blocks payroll's statutory export, and a payroll-service restart blocks hrms F&F. **Only the hrms→payroll direction has a circuit breaker**.

**5 services synchronously call ml-service** (billing, helpdesk, inventory, crm, project). ml-service outage creates a synchronous failure cascade across all 5 services unless each caller has a circuit breaker. Inspection shows billing, helpdesk, crm, and project all use `@civitasone/circuit-breaker`; **inventory-service does not** (the `forecast/ml-client.ts` and `forecast/consumer.ts` use bare `fetch` with no breaker).

---

## 5. Gap Analysis

### 5.1 Broken Topic Linkages — Produced ≠ Consumed (runtime dead letters)

| ID | Consumed Topic | Consuming Service | Actual Emitted Topic (Producer) | Evidence | Severity |
|---|---|---|---|---|---|
| BL-01 | `finance.payment.released` | analytics-service (INBOUND) | `finance.payment.made` (finance) | analytics INBOUND key `financePaymentReleased` maps to `.released`; finance EVENTS only has `paymentMade` = `"finance.payment.made"` | HIGH |
| BL-02 | `grants.release.processed` | analytics-service (INBOUND) | `grant.disbursement.completed` (grant) | Namespace mismatch (`grants.` vs `grant.`) + entity mismatch; grant EVENTS has `disbursementCompleted` = `"grant.disbursement.completed"` | HIGH |
| BL-03 | `payroll.run.finalized` | finance-service GL consumer | `payroll.run.disbursed` (payroll) | `finance/src/modules/gl/consumer.ts`: subscribes to `payroll.run.finalized`; payroll EVENTS defines only `runDisbursed` = `"payroll.run.disbursed"` | CRITICAL |
| BL-04 | `hrms.employee.updated` | meeting-service integration consumer | *(never emitted)* | hrms EVENTS has only: `employeeCreated`, `employeeSeparated`, `leaveApplied`, `leaveApproved`, `attendanceMarked`; `employee.updated` is absent | MEDIUM |
| BL-05 | `hrms.claim.approved` | payroll-service (CONSUMED_EVENTS.ltcClaimApproved) | *(never emitted)* | hrms COMMANDS has `claimApprove` but hrms EVENTS has no `claim.approved` topic | MEDIUM |
| BL-06 | `citizen.request.created` | notification-service domain-events consumer | *(never emitted)* | `notification/topics.ts` CONSUMED_EVENTS `citizenRequestCreated` = `"citizen.request.created"`; citizen EVENTS has no such key | MEDIUM |

---

### 5.2 Orphaned Events — Produced but No Registered Consumer (~124 total)

#### 5.2a Services where ALL events are orphaned (no consumer anywhere)

| Service | Orphaned Count | Sample Orphaned Events |
|---|---|---|
| admin-service | 14 | `admin.tenant.created`, `admin.breakglass.opened`, `admin.feature_flag.killed`, `admin.webhook.created` |
| identity-service | 15 | `identity.user.created`, `identity.session.created`, `identity.rbac.role.assigned`, `identity.rbac.permission.granted` |
| policy-service | 12 | `policy.role.created`, `policy.binding.created`, `policy.breakglass.requested`, `policy.abac.rule.created` |
| install-service | 5 | `install.wizard.completed`, `install.step.completed`, `install.stage.created` |
| location-service | 10 | `location.location.created`, `location.geofence.created`, `location.jurisdiction.assigned` |
| theme-service | 3 | `themes.token.created`, `themes.branding.upserted`, `themes.template.created` |
| plugin-service | 10 | `plugins.registry.installed`, `plugins.hook.registered`, `plugins.store.updated` |
| report-service | 9 | `reports.job.completed`, `reports.template.created`, `reports.scheduled.delivered` |
| notification-service | 8 | `notification.delivered`, `notification.failed`, `notification.campaign.created` |
| analytics-service | 9 | `analytics.query.run.completed`, `analytics.dashboard.created`, `analytics.export.created` |

**Subtotal: 95 fully orphaned events.**

#### 5.2b Services with majority-orphaned events

| Service | Total EVENTS | Consumed | Orphaned | Critical Orphans |
|---|---|---|---|---|
| contract-service | 22 | 0 | 22 | `contract.contract.signed`, `contract.esign.completed` |
| court-service | 30 | 3 (analytics) | 27 | `court.order.issued`, `court.notice.issued`, `court.appeal.filed`, `court.hearing.concluded` |
| meeting-service | 46 | 8 | 38 | `meeting.minutes.approved`, `meeting.resolution.passed`, `meeting.action_item.overdue` |
| knowledge-service | 16 | 0 | 16 | `knowledge.document.created`, `knowledge.share.created` |
| billing-service | 10 | 1 (ml) | 9 | `billing.invoice.paid`, `billing.payment.received` |
| inventory-service | 17 | 2 (ml) | 15 | `inventory.stock.low`, `inventory.match.completed`, `inventory.cycle-count.auto-posted` |
| payroll-service | 8 | 1 (finance) | 7 | `payroll.run.disbursed`, `payroll.fnf.computed`, `payroll.dsc.expiry_warning` |
| crm-service | 14 | 2 (ml) | 12 | `crm.deal.created`, `crm.contact.created`, `crm.account.created` |
| procurement-service | 21 | 4 | 17 | `procurement.tender.awarded`, `procurement.emd.forfeited`, `procurement.po.approval_rejected` |
| telephony-service | 14 | 1 (helpdesk) | 13 | `telephony.call.completed`, `telephony.call.transcription_completed` |
| stock-service | 2 | 0 | 2 | `stock.entry.created`, `stock.stock.negative_rejected` |
| ml-service | 11 | 6 | 5 | `ml.model.drift_detected`, `ml.bias.territory_deviation`, `ml.training.completed` |
| estab-service | 9 | 1 (citizen) | 8 | `estab.file.created`, `estab.resolution.created`, `estab.room.conflict` |
| asset-service | 7 | 0 | 7 | `asset.asset.created`, `asset.dep.posted`, `asset.disposed` |

**court-service specific note:** `CONSUMED_EVENTS = {} as const` — court-service produces 30+ domain events and subscribes to **zero** events from other services. It fires `notification.send` directly (OTP dispatch) as a fire-and-forget command rather than through the standard domain-event pipeline. The analytics-service INBOUND consumes 3 court events (`court.case.registered`, `court.case.status_changed`, `court.hearing.scheduled`) but court itself receives nothing back. All remaining 27 court events (orders, notices, appeals, hearings, evidence, compliance, cause-list) are unobserved by any downstream service.

**Critical missing wires identified:**

| Missing Wire | Business Impact |
|---|---|
| `billing.invoice.paid` → finance GL | Revenue not booked; accounts receivable settlement broken |
| `asset.asset.created` → finance GL | Asset capitalization journal never posted |
| `identity.user.created` → policy, notification | No default role binding; no welcome notification |
| `inventory.stock.low` → procurement | Reorder/indent not auto-triggered from low-stock signal |
| `contract.contract.signed` → procurement, legal | Contract activation invisible to downstream services |
| `court.order.issued` → legal, notification | Court orders invisible to legal-service; parties not notified |
| `ml.model.drift_detected` → (any alert) | Model quality degradation goes unobserved by operations |

---

### 5.3 Missing Audit Coverage — Access-Control Mutations Untracked

CLAUDE.md §3.8 requires every mutation to emit via `@civitasone/events`. Audit-service subscribes to `audit.event.record` (262 call-sites found across consumers). However:

| Gap | Services | Compliance Risk |
|---|---|---|
| Break-glass events (`admin.breakglass.opened/closed`) emitted to admin namespace only; audit-service has no subscription to `admin.breakglass.*` | admin | CERT-In; DPDP §5 |
| RBAC mutations (`identity.rbac.role.assigned`, `identity.rbac.permission.granted/revoked`) have no audit consumer registration | identity | Security audit requirement |
| Policy binding create/revoke (`policy.binding.created/revoked`) not forwarded to audit sink | policy | Access-control audit trail |

---

### 5.4 Domain Duplication Clusters

| Pattern | Services | Risk |
|---|---|---|
| **Warehouse master** | `stock-service` (`stock_warehouses`) + `inventory-service` (`warehouses`) — inventory mentions "unification with stock-service" in topics.ts but stock-service does NOT consume `inventory.warehouse.created/updated` | Two diverging warehouse masters |
| **Stock ledger** | `stock-service` (`stock_ledger`) + `inventory-service` (`stock_ledger`) | Parallel stock accounting; no reconciliation event between them |
| **Court case triple-tracking** | `estab-service` (`estab_court_cases`) + `legal-service` (`legal_cases`) + `court-service` (`cases`) | Three tables for court cases; no cross-service sync for government appearances in estab/legal flows |
| **RTI triple-tracking** | `citizen-service` (`citizen_rti_requests`) + `estab-service` (`estab_rti_requests`) + `hrms-service` (`hrms_rti_requests`) | Partial integration: `citizen.rti.filed` → estab, `estab.rti.responded` → citizen; hrms RTI entirely unwired |
| **Tenant master duplication** | `admin-service` (`admin_tenants`, emits `admin.tenant.created`) + `tenant-service` (`tenants`, emits `tenant.tenant.created`) | Downstream services subscribe to `tenant.tenant.created`; admin's copy is ignored |
| **Finance audit para shadow** | `finance-service` (`finance_audit_paras`) + `audit-service` (`audit_paras`) | Finance maintains its own para tracking; divergence risk from canonical audit-service |

---

### 5.5 Circular Event Dependencies

Five ML prediction loops exist — all pass through ml-service as a prediction oracle. None are causally circular (output triggers a different action than input). **Architecturally acceptable** but require circuit-breaker protection:

| Loop | Flow |
|---|---|
| Finance ↔ ML | `finance.transaction.posted` → ml anomaly detection → `ml.prediction.anomaly_detected` → finance alert |
| CRM ↔ ML | `crm.lead.updated/created` → ml scoring → `ml.prediction.lead_scored` → crm updates score |
| Helpdesk ↔ ML | `helpdesk.ticket.created/updated` → ml → `ml.prediction.breach_risk_high` → helpdesk escalation |
| Billing ↔ ML | `billing.subscription.updated` → ml → `ml.prediction.churn_risk_high` → billing dunning |
| Inventory ↔ ML | `inventory.receipt/issue.posted` → ml → `ml.prediction.stockout_risk` → inventory reorder |

**Risk:** No circuit-breaker found wrapping `inventory-service` → ml-service synchronous calls (`forecast/ml-client.ts`). The other 4 callers have circuit breakers.

---

## 6. Ranked Integration Gap List

| Rank | ID | Gap | Category | Severity |
|---|---|---|---|---|
| 1 | BL-03 | `payroll.run.finalized` never emitted — salary GL journal never posts; finance ledger missing all payroll cost entries | Broken topic linkage | **CRITICAL** |
| 2 | — | `billing.invoice.paid` → finance GL missing — revenue not booked from billing payments | Missing consumer | **HIGH** |
| 3 | BL-01 | `finance.payment.released` never emitted — analytics payment KPI always zero | Broken topic linkage | **HIGH** |
| 4 | BL-02 | `grants.release.processed` never emitted — analytics grant disbursement KPI always zero | Broken topic linkage | **HIGH** |
| 5 | — | metadata-service has no gateway route — custom field/entity API unreachable | Orphan API | **HIGH** |
| 6 | — | `inventory.stock.low` → procurement missing — low-stock never triggers reorder/indent | Missing consumer | **HIGH** |
| 7 | — | Access-control mutations (identity RBAC, policy binding, admin break-glass) produce no audit trail — CERT-In / DPDP §5 gap | Missing audit | **HIGH** |
| 8 | — | `asset.asset.created` → finance GL missing — asset capitalization journal never posted | Missing consumer | **HIGH** |
| 9 | — | court-service CONSUMED_EVENTS = {} — court produces 30+ events, receives 0; `court.order.issued` / `court.notice.issued` invisible to legal-service and notification-service | Missing consumer | **HIGH** |
| 10 | — | hrms ↔ payroll bidirectional synchronous HTTP — mutual availability dependency; payroll→hrms lacks circuit breaker | HTTP coupling risk | **HIGH** |
| 11 | BL-04 | `hrms.employee.updated` never emitted — committee membership cache stale after employee changes | Broken topic linkage | **MEDIUM** |
| 12 | BL-05 | `hrms.claim.approved` never emitted — LTC claim payouts never triggered in payroll | Broken topic linkage | **MEDIUM** |
| 13 | BL-06 | `citizen.request.created` never emitted — citizen request creation notifications never sent | Broken topic linkage | **MEDIUM** |
| 14 | — | `identity.user.created` → policy/notification missing — no default role binding, no welcome notification | Missing consumer | **MEDIUM** |
| 15 | — | `contract.contract.signed` → procurement/legal missing — contract activation invisible downstream | Missing consumer | **MEDIUM** |
| 16 | — | inventory → ml-service synchronous call has no circuit breaker — ml outage will block inventory demand forecast consumer | Missing resilience | **MEDIUM** |
| 17 | — | Warehouse master duplication (stock + inventory) — two diverging masters, no sync event | Domain overlap | **MEDIUM** |
| 18 | — | Tenant master duplication (admin + tenant) — admin emits its own tenant events not consumed by anyone | Domain overlap | **MEDIUM** |
| 19 | — | Court case triple-tracking (estab + legal + court) — no cross-service sync | Domain overlap | **MEDIUM** |
| 20 | — | RTI triple-tracking (citizen + estab + hrms) — hrms RTI not wired to citizen/estab | Domain overlap | **MEDIUM** |
| 21 | — | ML prediction loops uncircuit-broken (4 of 5 services have breakers; inventory does not) | Missing resilience | **MEDIUM** |
| 22 | — | `ml.model.drift_detected` / `ml.bias.territory_deviation` unobserved — model quality degradation invisible to ops | Missing consumer | **MEDIUM** |
| 23 | — | Finance audit para shadow (`finance_audit_paras`) — divergence risk from `audit-service.audit_paras` | Domain overlap | **LOW** |
| 24 | — | `finance.payment.eft.initiate` in finance CONSUMED_EVENTS but no matching producer in any service topics.ts | Unregistered producer | **LOW** |
| 25 | — | `simplified` finance module not wired to main GL events — MSME edition isolation at event layer unverified | Isolation gap | **LOW** |
| 26 | — | ~95 fully orphaned event topics across 10 services with zero consumers (admin, identity, policy, install, location, theme, plugin, report, notification, analytics) | Orphaned events | **LOW** |
| 27 | — | ~29 partially orphaned major service events (meeting, contract, court, knowledge) with no downstream consumers | Orphaned events | **LOW** |

---

## 7. Summary Statistics

| Metric | Value |
|---|---|
| Total services | 38 (+ gateway-service) |
| Services with gateway routes | 37 (metadata-service excluded) |
| Total DB tables | **559** across 37 data services (grep `.table(` count; court-service 22 tables included) |
| Shared-DB coupling violations | **0** |
| Cross-schema JOIN violations | **0** |
| Verified active event topic linkages | ~62 event pairs + 15 eOffice callbacks |
| Synchronous cross-service HTTP clients (internal) | **12** (4 gateway auth gates + 4 ML sync callers + 2 hrms/payroll + 1 helpdesk/asset + 1 court OTP) |
| **Broken topic linkages** | **6** |
| Services with ALL events orphaned | **10** |
| Orphaned event topics (approx.) | **~124** |
| Critical missing cross-service consumers | **9** (7 original + court orders + hrms/payroll HTTP gap) |
| Domain duplication clusters | **6** (5 original + court case triple-track) |
| Access-control audit gaps | **3** (identity RBAC, policy binding, admin break-glass) |
| ML prediction loops | **5** (4 protected, 1 unprotected) |
| Services without circuit breakers on synchronous HTTP calls | **3** (gateway: acceptable; inventory→ml: risk; payroll→hrms: risk) |

**Cross-module integration score: 4/10**

The service mesh pattern — CQRS + transactional outbox + per-service DB isolation — is structurally correct and no DB boundary violations are present. However:
- **6 broken topic linkages** cause silent data loss in Finance GL (payroll costs never posted), Analytics (payment/grant KPIs perpetually zero), and Notifications (citizen alerts dropped).
- **~124 orphaned domain events** represent unbuilt downstream pipelines — the integration bus is wired for roughly 35% of its intended signal coverage.
- **6 domain duplication clusters** (warehouse, tenant, court case, RTI, audit para, stock ledger) create data consistency risks that will surface under concurrent writes.
- **3 access-control audit gaps** are a DPDP §5 / CERT-In compliance risk.
- **court-service** (added this branch) has no inbound event subscriptions and 27 of its 30 events are unconsumed — orders, notices, and appeals are invisible to legal-service and notification-service.
- **12 synchronous inter-service HTTP calls** exist alongside the queue; bidirectional hrms↔payroll is the highest coupling risk. Inventory→ml has no circuit breaker.
- The eOffice callback bus (15 ref_types, all registered fail-closed) is the best-integrated subsystem in the mesh.

---

## 8. Verification Evidence

All findings above are based on executed code inspection, not README/comment trust. Key verification runs:

### 8.1 court-service test suite (branch: court-management-service)
```
QUEUE_DRIVER=memory npx vitest run --reporter=verbose
Test Files  39 passed | 7 skipped (46)
      Tests  285 passed | 37 skipped (322)
   Duration  5.17s
```
The 7 skipped test files are E2E tests (`*.e2e.test.ts`) requiring a live Postgres + Redis stack. All 39 unit/integration files pass. The 37 skipped individual tests are conditional on E2E infrastructure.

### 8.2 Broken-linkage grep evidence (all confirmed in-session)

| ID | Claim | Confirmed By |
|---|---|---|
| BL-01 | analytics INBOUND `financePaymentReleased = "finance.payment.released"` but finance EVENTS only has `paymentMade = "finance.payment.made"` | `analytics/src/topics.ts` INBOUND + `finance/src/topics.ts` EVENTS |
| BL-02 | analytics INBOUND `grantReleaseProcessed = "grants.release.processed"` but grant EVENTS has `disbursementCompleted = "grant.disbursement.completed"` (namespace + entity mismatch) | `analytics/src/topics.ts` INBOUND + `grant/src/topics.ts` EVENTS |
| BL-03 | finance CONSUMED_EVENTS has `payrollRunFinalized = "payroll.run.finalized"` but payroll EVENTS has only `runApproved` and `runDisbursed`; `finalized` is absent | `finance/src/topics.ts` CONSUMED_EVENTS + `payroll/src/topics.ts` EVENTS |
| BL-04 | meeting-service CONSUMED_EVENTS references `hrms.employee.updated` but hrms EVENTS has exactly 5 entries: `employeeCreated`, `employeeSeparated`, `leaveApplied`, `leaveApproved`, `attendanceMarked` | `hrms/src/topics.ts` EVENTS |
| BL-05 | payroll CONSUMED_EVENTS `ltcClaimApproved = "hrms.claim.approved"` but hrms EVENTS has no `claim.*` topic at all | `payroll/src/topics.ts` CONSUMED_EVENTS + `hrms/src/topics.ts` EVENTS |
| BL-06 | notification CONSUMED_EVENTS `citizenRequestCreated = "citizen.request.created"` but citizen EVENTS has 10 entries — none named `request.created` | `notification/src/topics.ts` CONSUMED_EVENTS + `citizen/src/topics.ts` EVENTS |

### 8.3 court-service isolation gap (CONSUMED_EVENTS = {} confirmed)
`services/court-service/src/topics.ts`: `export const CONSUMED_EVENTS = {} as const;` — zero inbound subscriptions. court-service produces 37 EVENTS; only 3 are consumed (by analytics-service: `courtCaseRegistered`, `courtCaseStatusChanged`, `courtHearingScheduled`). `court.order.issued`, `court.notice.issued`, `court.appeal.filed`, and 31 others are unconsumed.

### 8.4 DB table count
`grep -r "\.table(" services/*/src/modules/*/schema.ts | wc -l` → **559** tables across all 37 data services (court-service contributes 22).
