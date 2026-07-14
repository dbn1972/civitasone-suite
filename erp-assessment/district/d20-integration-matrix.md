# D20 — Consolidated Integration Matrix

**Lane:** L07 · **Date:** 2026-07-13  
**Reviewer role:** Enterprise Integration Architect  
**Source branch:** `court-management-service` · repo at `/tmp/cms-wt`

> This matrix consolidates all cross-domain, cross-tier, and external integration points identified across L07 (d17–d19) plus the existing broken linkages from `07-integration-matrix.md`. Verification status is marked [VERIFIED] (code or DB seen) or [PROPOSED] (recommended, not implemented).

---

## §1 — Current Broken/Missing Linkages (from 07-integration-matrix.md)

[VERIFIED: `erp-assessment/07-integration-matrix.md §1.2, §1.8`] Carried forward unresolved:

| Ref | From | To | Issue | Severity |
|---|---|---|---|---|
| INT-01 | All producers | All consumers | Schema registry (`validatePayload()`) not wired at publish/consume time — schema evolution unconstrained | HIGH |
| INT-02 | plugin-runtime | DB | Consumer writes to DB without `markProcessed` — duplicate hook on redelivery | MEDIUM |
| INT-03 | payroll→hrms, helpdesk→asset, stock→inventory, tenant→billing | Downstream services | HTTP calls with timeout but no circuit breaker | MEDIUM |
| INT-04 | billing/churn, helpdesk/ml-breach, inventory/forecast | ML side-effect consumers | `markProcessed` absent | LOW |
| AUD-01 | finance, hrms, payroll | audit-service | `oldValue`/`newValue` not sent — field-level diff absent | HIGH |
| AUD-02 | All services | audit-service | Actor roles never captured in audit payload | MEDIUM |
| AUD-03 | plugin-runtime | audit-service | Plugin executions not audited | MEDIUM |

---

## §2 — Full Cross-Domain Integration Matrix

### 2A — Internal Service-to-Service (Existing + Proposed)

| From | To | Mechanism | Event/API | Data Shared | Classification | Sync/Async | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| All services | audit-service | async event | `audit.event.record` | action, resourceType, resourceId, outcome | INTERNAL | Async | ✅ [VERIFIED] — missing oldValue/newValue | P0 fix |
| procurement-service | finance-service | async event | `procurement.grn.accepted` | GRN ID, amount, PO ref | INTERNAL | Async | ✅ [VERIFIED] | — |
| procurement-service | stock-service | async event | `procurement.grn.accepted` | GRN ID, item quantities | INTERNAL | Async | ✅ [VERIFIED] | — |
| tenant-service | identity-service, hrms, finance, admin | async event | `tenant.tenant.created` | tenantId, edition | INTERNAL | Async | ✅ [VERIFIED] | — |
| identity-service | hrms, notification, policy | async event | `identity.user.created` | userId, email, roles | INTERNAL | Async | ✅ [VERIFIED] | — |
| hrms-service | payroll-service | async event | `hrms.payroll.run.completed` | payroll run ref | INTERNAL | Async | ✅ [VERIFIED] | — |
| finance-service | analytics-service | async event | `finance.gl.posted` | journal summary | INTERNAL | Async | ✅ [VERIFIED] | — |
| payroll-service | hrms-service | sync HTTP | `GET /v1/hrms/internal/payroll-input` | employee payroll inputs | INTERNAL | Sync | ✅ [VERIFIED] — no circuit breaker | P1 |
| helpdesk-service | asset-service | sync HTTP | `GET /v1/assets/{id}` | asset details | INTERNAL | Sync | ✅ [VERIFIED] — no circuit breaker | P1 |
| grant-service | finance-service | async event | `grant.disbursement.completed` ← `finance.payment.made` | payment ref | INTERNAL | Async | ✅ [VERIFIED] | — |
| project-service | grant-service | async event | `project.milestone.completed` → grant UC gate | milestone ref | INTERNAL | Async | ✅ [VERIFIED] | — |
| citizen-service | estab-service | async event | `estab.rti.responded` → citizen | RTI response ref | INTERNAL | Async | ✅ [VERIFIED] | — |
| court-service | notification-service | async event | `notification.send` (OTP for case status) | channel, template, OTP | INTERNAL | Async | ✅ [VERIFIED] | — |
| meeting-service | project-service | async event | `meeting.decision.project` | decision text, projectRef | INTERNAL | Async | ✅ [VERIFIED] | — |

### 2B — New Internal Integrations Required (Proposed)

| From | To | Mechanism | Event/API | Data Shared | Classification | Sync/Async | Priority |
|---|---|---|---|---|---|---|---|
| coordination-service | citizen-service | async event | `district.event_permission.granted.v1` | permissionId, status | INTERNAL | Async | P0 |
| coordination-service | sp-office queue | async event | `district.police.force.requisitioned.v1` | requisitionId, strength, purpose | RESTRICTED | Async | P0 |
| coordination-service | dm-office queue | async event | `district.police.force.deployed.v1` | deploymentRef, actualStrength | RESTRICTED | Async | P0 |
| coordination-service | finance-service | async event | `disaster.relief.disbursed.v1` → finance receipt | incidentId, amount, schemeRef | RESTRICTED | Async | P0 |
| coordination-service | grant-service | async event | `disaster.incident.declared.v1` → SDRF scheme trigger | incidentId, affectedArea | RESTRICTED | Async | P0 |
| coordination-service | notification-service | async event | `district.laworder.plan.created.v1` → officer alert | planId, officeId | CONFIDENTIAL | Async | P0 |
| coordination-service | audit-service | async event | All coordination events → `audit.event.record` | Full event envelope | CONFIDENTIAL | Async | P0 |
| scheme-registry | grant-service | async event | `scheme.scheme_master.created.v1` | schemeMasterId, govLevel, fundingPattern | INTERNAL | Async | P0 |
| scheme-registry | project-service | async event | `scheme.scheme_master.created.v1` | same | INTERNAL | Async | P0 |
| scheme-registry | notification-service | async event | `scheme.guideline.issued.v1` | guidelineRef, effectiveDate | INTERNAL | Async | P1 |
| scheme-registry | grant-service | async event | `scheme.target.allocated.v1` | officeId, period, targets | INTERNAL | Async | P1 |
| report-service | scheme-registry | async event | `scheme.progress_report.submitted.v1` | schemeId, period, pct, amount | INTERNAL | Async | P1 |
| grant-service | audit-service | async event | `scheme.audit_observation.raised.v1` | paraId, schemeId, amount | CONFIDENTIAL | Async | P2 |
| location-service | all services | async event | `hierarchy.office.created.v1` | officeId, jurisdictionId, govLevel | INTERNAL | Async | P0 |

---

## §3 — Cross-Tier Integrations (District↔State↔Ministry)

| From | To | Mechanism | Event/API | Data Shared | Classification | Sync/Async | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| district grant-service | state scheme-registry | async event | `scheme.uc.submitted` → state validation | ucId, period, amounts | RESTRICTED | Async | [PROPOSED] | P1 |
| district project-service | state report-service | async event | `scheme.progress_report.submitted.v1` | schemeId, period, physical%, financial | INTERNAL | Async | [PROPOSED] | P1 |
| state scheme-registry | district tenants | async event | `scheme.fund.released.v1` | installmentNo, amountMinor, pfmsRef | RESTRICTED | Async | [PROPOSED] | P0 |
| state scheme-registry | district tenants | async event | `scheme.target.allocated.v1` | period, targets by officeId | INTERNAL | Async | [PROPOSED] | P1 |
| state scheme-registry | ministry portal | async HTTP adapter | Progress report push | Aggregated progress (no PII) | INTERNAL | Async | [PROPOSED] | P1 |
| district coordination | divisional commissioner | async event | `district.incident.escalated.v1` | incidentId, resourcesExhausted | RESTRICTED | Async | [PROPOSED] | P0 |
| divisional commissioner | state secretariat | async event | `district.incident.escalated.v1` | same, escalated further | RESTRICTED | Async | [PROPOSED] | P0 |
| state home dept | DGP | async event | `district.laworder.critical.v1` | summary | CONFIDENTIAL | Async | [PROPOSED] | P1 |
| district citizen-service | state CPGRAMS | async HTTP adapter | Grievance push/pull | grievanceId, status (no PII detail) | INTERNAL | Bidirectional | [PROPOSED] | P1 |

**Prerequisite:** All cross-tier integrations require parent-child tenant model OR signed cross-tenant JWT with audience claim for target tier [d08-tenant-isolation-report.md §4 — cross-tenant isolation]. Today's flat tenant model (all tenants equal) prevents federated aggregation.

---

## §4 — External System Adapters

| From/To | External System | Adapter | Protocol | Direction | Data | PII Risk | Status | Priority |
|---|---|---|---|---|---|---|---|---|
| coordination-service | CCTNS/ICJS | `cctns-adapter` | REST (ICJS API) + mTLS | Inbound pull only | FIR reference, case status, bail status — NO case diary | None (reference only) | [MISSING] | P0 |
| finance-service + scheme-registry | PFMS | `pfms-adapter` | PFMS Public API v3 + OAuth2 | Bidirectional | GOO, fund releases, UC status | Minimal | [MISSING] | P0 |
| finance-service + citizen-service | State Treasury / IFMS | `ifms-adapter` | SOAP/REST + mutual TLS (state-specific) | Bidirectional | Challan, payment order, receipt | Minimal | [MISSING] | P0 |
| visitor-service | DigiLocker | `digilocker-adapter` | DigiLocker Gateway API + PKI | Inbound pull | Document verification result (URI + signature) | YES — consent required, DPDP §3 | Stub exists [VERIFIED visitor-service] — not at GIG | P1 |
| visitor-service | Aadhaar (UIDAI) | `aadhaar-face-adapter` | AUA API + HMAC | Inbound | Verification Y/N only — no Aadhaar storage | YES — DPDP §4, masked [VERIFIED grant-service] | Stub exists [VERIFIED visitor-service] — not at GIG | P0 |
| citizen-service | CPGRAMS | `cpgrams-adapter` | CPGRAMS REST API | Bidirectional | grievanceId, status, response text | Minimal | [MISSING] | P1 |
| coordination-service | ECI election portal | `eci-adapter` | ECI API | Bidirectional | Booth deployment plan, sensitive booth list | Minimal | [MISSING] | P1 |
| grant-service / project-service | PFMS | `pfms-adapter` (shared) | PFMS API | Bidirectional | UC submission, fund release tracking | Minimal | [MISSING] | P0 |
| identity-service | Keycloak (OIDC/SAML) | Keycloak integration | OIDC + SAML | Existing | JWT, session | YES | [VERIFIED] ✅ | — |
| citizen-service | GIS / Bhuvan | `gis-adapter` | OGC WFS/WMS + REST | Inbound pull | Geo-polygon, LGD boundary, survey numbers | None | [MISSING] | P1 |
| payroll-service | NACH (NPCI) | `nach-adapter` | NACH file + DSC | Outbound | Payment files | YES | ✅ [VERIFIED — circuit breaker present] | — |
| visitor-service | OCR service | `ocr-adapter` | REST | Outbound | Document image | YES | ✅ [VERIFIED — circuit breaker present] | — |
| notification-service | SMS/Email gateway | NIC gateway / MSG91 | REST | Outbound | SMS, email | YES | Partial [VERIFIED notification topics exist] | P1 |
| report-service | Ministry MIS portals | Per-ministry adapter | REST (varied) | Outbound push | Aggregated scheme progress (no PII) | None | [MISSING] | P2 |

---

## §5 — Event Bus Topology (Current vs Target)

### 5A — Current Topology [VERIFIED]

```
Producer (service) 
  → SQS FIFO queue: {topic}  (MessageGroupId = tenantId)
  → SqsQueue.publish() fans out to: {topic}__{subscriberService} queues
  → Consumer pulls from own queue, markProcessed, writes to DB, enqueues outbox
  → Outbox relay publishes domain events

Envelope: messageId, type, tenantId, actorId, correlationId, causationId?, timestamp, schemaVersion, payload
DLQ:      {topic}-dlq via RedrivePolicy (maxReceiveCount=5)
```

### 5B — Target Topology for District Platform [PROPOSED]

```
Producer (district service) 
  → Gov Event Bus (SQS FIFO / Kafka / RabbitMQ via @civitasone/queue adapter)
  → Topic routing: 
      • tenantId = district-office UUID (as today)
      • + routingKeys: govLevel, district (LGD), department, classification
  → Government Integration Gateway validates:
      • schema (schema-registry wired)
      • classification vs caller's clearance
      • purpose-code vs data-sharing-agreement
      • replay protection (5-min timestamp window + nonce)
  → Fan-out:
      • district consumers (as today)
      • state aggregation consumers (cross-tenant, authorized)
      • ministry adapters (outbound push, one per ministry portal)
      • audit-service (enriched with officeId, classification, retentionPolicy)

Envelope: extended GovEventEnvelope (see d19 §2)
DLQ:      per-topic DLQ with classification tag; DLQ consumers require same clearance
```

---

## §6 — New Topics Required (Summary)

All [PROPOSED]. Count of new event topics required for district governance:

| Domain | New Topic Count | Key Topics |
|---|---|---|
| Coordination (Collector↔SP) | 10 | laworder.plan, exec_magistrate.deployed, force.requisitioned/deployed, incident.closed, aar.submitted |
| Disaster | 7 | incident.declared/escalated, resource.deployed, relief.disbursed, missing_person.registered/linked, eoc.activated |
| Police (non-CCTNS) | 6 | assistance.requested/provided, missing_person.found, arms_clearance.provided/refused |
| Scheme/Ministry | 10 | scheme_master.created, guideline.issued, target.allocated, fund.released, progress_report.submitted, uc.validated/rejected, audit_observation.raised, compliance_response.submitted, beneficiary.aggregated |
| Election | 3 | election.deployment.plan.created, election.sensitive_booth.updated, election.result.certified |
| Grievance (district tier) | 4 | grievance.escalated, grievance.district_assigned, grievance.cross_district.transferred, inspection.noncompliance.created |
| Hierarchy/Org | 5 | office.created, position.created, posting.created, jurisdiction.assigned, delegation.granted |
| **Total new** | **45** | — |

Existing events needing envelope enrichment: ~12 (see d19 §3.5).

---

## §7 — Priority Register: Integration Gaps

| ID | Finding | Priority | Dependent On |
|---|---|---|---|
| D20-01 | 0 of 45 new district governance event topics exist in any topics.ts | P0 | Org model (L02) |
| D20-02 | Government Integration Gateway service absent | P0 | — |
| D20-03 | Event envelope missing 8 district-platform fields | P0 | — |
| D20-04 | Schema registry unwired (inherited from INT-01) | P0 | — |
| D20-05 | PFMS adapter absent | P0 | — |
| D20-06 | CCTNS/ICJS adapter absent | P0 | Statutory clearance required |
| D20-07 | State Treasury/IFMS adapter absent | P0 | State-specific config |
| D20-08 | Cross-tenant federation model absent | P0 | Tenant model (L01) |
| D20-09 | `officeId`/`district` not injected by gateway | P0 | Org model (L02) |
| D20-10 | Classification-based filtering absent | P0 | — |
| D20-11 | Purpose enforcement (DPDP §3) absent | P0 | — |
| D20-12 | coordination-service does not exist | P0 | Org model (L02) |
| D20-13 | scheme-registry module does not exist | P0 | — |
| D20-14 | Ministry authority table does not exist | P0 | — |
| D20-15 | `oldValue`/`newValue` absent from financial audit events (inherited AUD-01) | P0 | — |
| D20-16 | Circuit breakers missing on 4 HTTP paths (inherited INT-03) | P1 | — |
| D20-17 | mTLS absent for cross-tier calls | P1 | Infra (L-infra) |
| D20-18 | Digital signatures absent for govt orders/events | P1 | PKI/DSC infra |
| D20-19 | DigiLocker adapter stub not at GIG level | P1 | GIG service |
| D20-20 | CPGRAMS adapter absent | P1 | — |
| D20-21 | Sandbox routing absent at gateway | P1 | — |
| D20-22 | Replay protection absent | P1 | — |
| D20-23 | ECI election portal adapter absent | P1 | Statutory clearance |
| D20-24 | Ministry MIS portal adapters absent | P2 | Per-ministry negotiation |
| D20-25 | Beneficiary aggregate cross-tenant read-model absent | P2 | Cross-tenant model |
| D20-26 | `plugin-runtime` idempotency gap (inherited INT-02) | P1 | — |

---

## §8 — Implementation Sequencing

```
PHASE 0 (P0 — before district pilot):
  ① Org model: migrate hierarchy.offices, positions, postings, jurisdictions to DB (L02)
  ② Extend event envelope: add officeId, jurisdictionId, govLevel, district, state, classification, retentionPolicy
  ③ Wire schema registry at publish/consume boundary (packages/events + packages/queue)
  ④ Add officeId/district claims to JWT; gateway enriches forwarded headers
  ⑤ Create coordination-service with disaster + force-requisition modules
  ⑥ Create scheme-registry module with gov_authorities + scheme_masters tables
  ⑦ Create Government Integration Gateway service skeleton (mTLS, classification filter, purpose check)
  ⑧ PFMS adapter (read-only pull first, UC push second)
  ⑨ IFMS/Treasury adapter (payment reconciliation)
  ⑩ Fix oldValue/newValue in financial audit consumers (AUD-01)

PHASE 1 (P1 — before district rollout):
  ① Cross-tenant federation model (parent-child tenant or signed cross-tenant JWT)
  ② coordination-service: election + licensing modules
  ③ scheme-registry: target allocation + indicator framework
  ④ DigiLocker / CPGRAMS / ECI adapters at GIG level
  ⑤ Circuit breakers on all 4 HTTP paths (INT-03)
  ⑥ mTLS for cross-district and district→state calls
  ⑦ Sandbox routing

PHASE 2 (P2 — before state rollout):
  ① Ministry MIS adapter framework (pluggable per scheme)
  ② Beneficiary aggregate cross-tenant read-model
  ③ Digital signatures on all coordination events
  ④ Data sharing agreement enforcement at GIG

PHASE 3 (P3 — ministry federation):
  ① NeSDA registration
  ② Ministry portal push adapters (PMAY, MGNREGS, etc.)
  ③ State Data Exchange (NIC-SDX) integration
```

---

*Cross-references: 07-integration-matrix.md (existing event contracts), d17 (Collector↔SP), d18 (ministry federation), d19 (event catalogue + gateway)*
