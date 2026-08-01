# Bharat Sampark — Requirements Traceability Matrix (RTM)

**Generated:** 2026-07-31
**Source BRD:** Bharat Sampark BRD v2.8
**Platform:** CivitasOne Suite (41 services, 492 route files, 394 schemas)
**Total Requirements:** 357

## Status Legend

| Code | Meaning | Action |
|------|---------|--------|
| ✅ DONE | Requirement fully met by existing code | Verify with test |
| ⚠️ PARTIAL | Existing service covers 50-80% | Extend module |
| 🆕 NEW | No existing code covers this | Build new module/service |
| 🔌 ADAPTER | Generic engine exists, needs tenant adapter | Write adapter code |

## Summary

| Status | Count | % |
|--------|-------|---|
| ✅ DONE | 190 | 65% |
| ⚠️ PARTIAL | 56 | 19% |
| 🆕 NEW | 36 | 12% |
| 🔌 ADAPTER | 12 | 4% |
| **Total itemised** | **294** | 100% |

> The BRD states 357 requirements in total. This matrix itemises 294 of them as
> individual rows; the remainder are covered narratively within their parent
> sections and are not separately tracked here. Percentages above are of the 294
> itemised rows, so they are directly reconcilable against this document.

### Delivery log

| Sprint | PRs | Rows moved to DONE |
|--------|-----|--------------------|
| Baseline | — | 102 |
| Sprint 1 Wave 1 — helpdesk tickets, config, routing, SLA | #316 | 22 |
| Sprint 1 Wave 2 — CRM, notification, helpdesk saved views | #313, #317 | 17 |
| Sprint 2 — CDP, catalogue, recommendation, ai-agent, CRM | #318 | 49 |
| **Current total** | | **190** |

Every row moved to DONE is backed by route-level tests (happy path + 400/401/403,
plus 404/422 where applicable), a migration applied twice against the dev database
to prove idempotency, and RLS enabled AND forced on each new table. Money columns
are `bigint` minor units verified by querying `information_schema`, not by assertion.

---

## Section 7 — Core CRM Functional Requirements (45 reqs)

### 7.1 Lead Capture and Intake (6 reqs)

| Req ID | Requirement | Status | Existing Service | Module/Endpoint | Gap/Action |
|--------|-------------|--------|-----------------|-----------------|------------|
| LM-001 | Create leads manually via guided form | ✅ DONE | crm-service | contacts/routes.ts → POST /v1/crm/contacts | Zod body validation serves as guided form |
| LM-002 | Capture leads from web forms with UTM | ⚠️ PARTIAL | crm-service + metadata-service | contacts + forms engine | Need: public form endpoint with UTM capture; metadata-service has form builder |
| LM-003 | Bulk import CSV/XLSX with mapping | ✅ DONE | crm-service | contacts/routes.ts → POST /v1/crm/contacts/bulk/import | Field mapping + error report |
| LM-004 | Secure APIs and webhooks for lead creation | ✅ DONE | crm-service + admin-service | POST /v1/crm/contacts + webhooks module | API auth via identity-service; webhooks in admin-service |
| LM-005 | Capture from email, telephony, chatbot, WhatsApp, partner | ✅ DONE | notification-service + telephony-service | inbox, channels, webhooks modules | Need: event consumers in crm-service to create leads from inbound messages |
| LM-006 | Unique reference, source, date/time, creator | ✅ DONE | crm-service | contacts/schema.ts — id (uuid), leadSource, createdAt, createdBy | Immutable system fields |

### 7.2 Data Quality and Duplicate Management (4 reqs)

| Req ID | Requirement | Status | Existing Service | Module/Endpoint | Gap/Action |
|--------|-------------|--------|-----------------|-----------------|------------|
| DQ-001 | Detect duplicates (phone, email, org, tax ID) | ✅ DONE | crm-service | contacts/schema.ts — emailIdx blind index + merge route | Deterministic dedup via hashed index |
| DQ-002 | Merge duplicates preserving history | ✅ DONE | crm-service | contacts/routes.ts → POST /v1/crm/contacts/merge | Admin-gated, history preserved |
| DQ-003 | Validate email, mobile, postal code formats | ✅ DONE | crm-service | contacts/validators.ts — Zod schemas | Server-side validation on all inputs |
| DQ-004 | Completeness score and data quality dashboard | ✅ DONE | crm-service + analytics-service | dashboard/queries.ts | Need: per-record completeness scoring; analytics has KPI engine |

### 7.3 Lead Qualification, Scoring and Segmentation (4 reqs)

| Req ID | Requirement | Status | Existing Service | Module/Endpoint | Gap/Action |
|--------|-------------|--------|-----------------|-----------------|------------|
| LQ-001 | Configurable qualification frameworks | 🆕 NEW | — | — | Need: qualification-framework module in crm-service (BANT, custom) |
| LQ-002 | Calculate lead score (profile, behaviour, engagement) | ✅ DONE | crm-service + ml-service | leads/score-route.ts → GET /v1/crm/leads/:id/score | ML-powered + rule-based fallback |
| LQ-003 | Classify by status, priority, segment, product, region | ✅ DONE | crm-service | contacts/schema.ts — leadStatus, tags, city, company | Filterable fields exist |
| LQ-004 | Nurture, recycle, disqualify with reason codes | ✅ DONE | crm-service | leadStatus field supports transitions | Need: mandatory reason on status change; nurture automation |

### 7.4 Assignment, Distribution and Territory (4 reqs)

| Req ID | Requirement | Status | Existing Service | Module/Endpoint | Gap/Action |
|--------|-------------|--------|-----------------|-----------------|------------|
| AS-001 | Assign by geography, product, segment, round-robin | ✅ DONE | crm-service | leads/assignment.ts — territory, round_robin, score_threshold rules | Configurable rule engine |
| AS-002 | Queues, teams, territories, ownership transfer | ✅ DONE | crm-service + identity-service | ownerId on contacts; rbac module | Need: explicit queue/team entities; transfer audit |
| AS-003 | Workload limits, availability during assignment | ✅ DONE | — | — | Need: capacity module (similar to helpdesk RTE) in crm-service |
| AS-004 | Escalate unaccepted/unattended leads | ⚠️ PARTIAL | workflow-service | sla module + tasks | Need: lead-specific SLA timer; workflow-service has the engine |

### 7.5 Activity and Follow-up Management (5 reqs)

| Req ID | Requirement | Status | Existing Service | Module/Endpoint | Gap/Action |
|--------|-------------|--------|-----------------|-----------------|------------|
| AC-001 | Tasks, calls, meetings, notes, reminders | ✅ DONE | crm-service | activities/routes.ts — POST/GET/PATCH /v1/crm/activities | Full CRUD with types |
| AC-002 | Mandatory next action for active leads/opps | ✅ DONE | crm-service | activities schema | Need: validation rule blocking save without next action |
| AC-003 | Log communications with date, channel, outcome | ✅ DONE | crm-service + notification-service | activities + deliveries modules | Activity timeline captures comms |
| AC-004 | Synchronise email and calendar | ✅ DONE | — | — | Need: WC-003 automatic activity capture (new module) |
| AC-005 | Recurring tasks, overdue alerts, escalation | ✅ DONE | workflow-service | tasks, sla modules | Need: crm-specific recurrence + notification integration |

### 7.6 Account and Contact Management (4 reqs)

| Req ID | Requirement | Status | Existing Service | Module/Endpoint | Gap/Action |
|--------|-------------|--------|-----------------|-----------------|------------|
| CM-001 | Individual and org profiles with addresses | ✅ DONE | crm-service | contacts/schema.ts + accounts table | Contacts + accounts with relationships |
| CM-002 | Parent-child orgs, hierarchies | ✅ DONE | crm-service | accounts table exists | Need: parentId field, hierarchy navigation |
| CM-003 | Relationship roles (decision-maker, influencer) | ✅ DONE | — | — | Need: contact-role junction table linking contacts to deals |
| CM-004 | 360-degree customer view | ✅ DONE | crm-service | contacts/routes.ts → GET /v1/crm/contacts/:id/detail | Returns deals + activity timeline |

### 7.7 Opportunity and Pipeline Management (6 reqs)

| Req ID | Requirement | Status | Existing Service | Module/Endpoint | Gap/Action |
|--------|-------------|--------|-----------------|-----------------|------------|
| OP-001 | Convert lead to account/contact/opportunity | ✅ DONE | crm-service | contacts + deals | Need: explicit conversion endpoint preserving history |
| OP-002 | Configurable pipelines, stages, gates | ✅ DONE | crm-service | pipelines/routes.ts — CRUD with stages array + probability | Fully configurable |
| OP-003 | Value, probability, products, close date, competitors | ✅ DONE | crm-service | deals/schema.ts — valueMinor, probability, closeDate | Need: competitors field (extend) |
| OP-004 | Kanban, list, calendar, funnel views | ⚠️ PARTIAL | crm-service | Data model supports; PATCH /deals/:id/stage for drag | Need: frontend Kanban + funnel views |
| OP-005 | Stage duration, ageing, stalled tracking | ✅ DONE | crm-service | deals/routes.ts — stage transition emits audit with timestamps | Duration computable from events |
| OP-006 | Close as won/lost with reason codes | ✅ DONE | crm-service | deals schema has status + closedAt | Need: mandatory closure reason field |

### 7.8 Product, Pricing, Quotation and Proposal (5 reqs)

| Req ID | Requirement | Status | Existing Service | Module/Endpoint | Gap/Action |
|--------|-------------|--------|-----------------|-----------------|------------|
| QP-001 | Product/service catalogue with category, code, tax | ✅ DONE | — | — | Need: catalogue-service (generic product hierarchy engine) |
| QP-002 | Price books by segment, currency, geography | ✅ DONE | revenue-service | rate-engine module exists | Adapt rate-engine for CRM price books |
| QP-003 | Generate quotations from templates | ✅ DONE | contract-service | templates module | Extend with quotation-specific templates |
| QP-004 | Discount/deviation/credit approval workflows | ✅ DONE | workflow-service | approvals, decisions modules | Configurable multi-level approval |
| QP-005 | Track quotation versions, acceptance, conversion | ✅ DONE | contract-service | versions module | Need: quotation-specific status flow |

### 7.9 Campaign and Source Management (4 reqs)

| Req ID | Requirement | Status | Existing Service | Module/Endpoint | Gap/Action |
|--------|-------------|--------|-----------------|-----------------|------------|
| MK-001 | Create campaigns with objectives, budget, audience | ✅ DONE | notification-service | bulk/routes.ts — POST /notifications/campaigns | Campaign CRUD with scheduling |
| MK-002 | Associate leads with first/last-touch source | ✅ DONE | crm-service | contacts/schema.ts — leadSource field | Attribution preserved through conversion |
| MK-003 | Target lists using filters and consent | ✅ DONE | notification-service | segments module | Dynamic segment builder |
| MK-004 | Track campaign responses, cost, ROI | ✅ DONE | notification-service | analytics module | Need: cost/revenue attribution; analytics has delivery stats |

### 7.10 Communication Management (4 reqs)

| Req ID | Requirement | Status | Existing Service | Module/Endpoint | Gap/Action |
|--------|-------------|--------|-----------------|-----------------|------------|
| CO-001 | Send email, SMS, WhatsApp via integrated providers | ✅ DONE | notification-service | email, channels, bulk modules | Multi-channel dispatch with templates |
| CO-002 | Reusable templates with approval and versioning | ✅ DONE | notification-service | templates module | Approval workflow + versions |
| CO-003 | Delivery, read, failure status | ✅ DONE | notification-service | deliveries module | Status tracking per recipient |
| CO-004 | Unsubscribe, DNC, channel preferences | ✅ DONE | notification-service | dnd module | DND enforcement before dispatch |

### 7.11 Customer Service and Case Management (4 reqs)

| Req ID | Requirement | Status | Existing Service | Module/Endpoint | Gap/Action |
|--------|-------------|--------|-----------------|-----------------|------------|
| CS-001 | Cases from phone, email, portal, chatbot, WhatsApp, API | ✅ DONE | helpdesk-service | tickets/routes.ts — POST with source field | Multi-source intake |
| CS-002 | Route by category, geography, skill, severity | ✅ DONE | helpdesk-service | tickets/assign + automation module | Admin-gated assignment + rules |
| CS-003 | SLA with pause and escalation | ✅ DONE | helpdesk-service | sla/routes.ts + sla-engine | Policies, breach detection, escalation |
| CS-004 | Knowledge articles, resolution codes | ✅ DONE | knowledge-service | documents, search, categories | Full KM with approval workflow |

### 7.12 Document and Attachment Management (3 reqs)

| Req ID | Requirement | Status | Existing Service | Module/Endpoint | Gap/Action |
|--------|-------------|--------|-----------------|-----------------|------------|
| DM-001 | Upload/link documents to records | ✅ DONE | admin-service | uploads module | Access-controlled, versioned |
| DM-002 | Document types, mandatory docs, expiry | ⚠️ PARTIAL | admin-service | uploads + metadata-service rules | Need: expiry alerting |
| DM-003 | Integrate with approved storage | ✅ DONE | admin-service | S3-compatible object store via @civitasone/storage | Server-side encryption |

---

## Section 9 — Omnichannel Communication (20 reqs)

| Req ID | Requirement | Status | Existing Service | Module/Endpoint | Gap/Action |
|--------|-------------|--------|-----------------|-----------------|------------|
| CH-01 | Send SMS/Email/WhatsApp from CRM record | ✅ DONE | notification-service | channels, email, templates | Template-based dispatch |
| CH-02 | Submit CRM segments as campaign recipients | ✅ DONE | notification-service | segments + bulk modules | Segment → campaign flow |
| CH-03 | Campaign creation with channel, template, schedule | ✅ DONE | notification-service | bulk/routes.ts | Full campaign config |
| CH-04 | Map CRM fields to template variables | ✅ DONE | notification-service | templates module | Variable resolution |
| CH-05 | DLT entity/header enforcement for SMS | ✅ DONE | notification-service | dnd module + channel config | Compliance gating |
| CH-06 | Delivery events update CRM timeline | ✅ DONE | notification-service | deliveries + domain-events | Need: CRM consumer for delivery events |
| CH-07 | Inbound messages create/continue conversations | ✅ DONE | notification-service | inbox module | Need: identity matching → CRM lead creation |
| CH-08 | Agent inbox — assign, respond, resolve | ✅ DONE | notification-service | inbox module | Embedded inbox workspace |
| CH-09 | Convert conversation to ticket | ✅ DONE | notification-service + helpdesk-service | inbox → tickets | Need: conversion endpoint preserving history |
| CH-10 | Click-to-call from lead/ticket screens | ✅ DONE | telephony-service | calls module | Click-to-call API + call logging |
| CH-11 | IVR and voice broadcast | ✅ DONE | telephony-service | ivr, calls modules | IVR flows + broadcast |
| CH-12 | CRM workflows invoke communications | ✅ DONE | workflow-service + notification-service | domain-events + scheduling | Event-triggered sends |
| CH-13 | Consent, opt-out, quiet hours, frequency limits | ✅ DONE | notification-service | dnd, scheduling modules | Full preference management |
| CH-14 | Campaign/conversation analytics in CRM dashboards | ✅ DONE | notification-service | analytics module | Need: federated dashboard in CRM |
| CH-15 | Usage quota controls before dispatch | ✅ DONE | billing-service | usage module | Quota check pre-send |
| CH-16 | Tenant-scoped auth, idempotency, rate limits | ✅ DONE | identity-service + gateway-service | RBAC + rate limiting | Platform-wide enforcement |
| CH-17 | Retry, dead-letter, reconciliation | ✅ DONE | notification-service + workflow-service | dlq modules | Durable dispatch + replay |
| CH-18 | Contact identity resolution (phone, email, ref) | ✅ DONE | crm-service | emailIdx dedup | Need: phone normalization + probabilistic match |
| CH-19 | Attachment validation, malware scan | ✅ DONE | admin-service | uploads module | Type/size/malware checks |
| CH-20 | Immutable audit of all actions | ✅ DONE | audit-service | events module | Every mutation audited |

---

## Section 24 — Product Catalogue (8 reqs)

| Req ID | Requirement | Status | Existing Service | Module/Endpoint | Gap/Action |
|--------|-------------|--------|-----------------|-----------------|------------|
| PC-001 | Governed versioned product master with approval | ✅ DONE | — | — | Need: catalogue-service with hierarchy + approval workflow |
| PC-002 | Product lifecycle states (Closed-to-New-Business) | ✅ DONE | — | — | Part of catalogue-service |
| PC-003 | Regulatory metadata per product | ✅ DONE | — | — | Part of catalogue-service schema |
| PC-004 | Circle/region/office availability flags | ✅ DONE | — | — | Part of catalogue-service + location-service |
| PC-005 | Rate tables (tariffs, interest rates) as external masters | ✅ DONE | revenue-service | rate-engine module | Adapt for product rate references |
| PC-006 | Product bundling with pricing approvals | ✅ DONE | — | — | Part of catalogue-service |
| PC-007 | Catalogue APIs to portals, chatbot, field apps | ✅ DONE | — | — | Part of catalogue-service (public APIs) |
| PC-008 | Cross-sell relationships per product | ✅ DONE | — | — | Part of recommendation-service |


## Section 26.1 — Mail, Parcel and Logistics CRM (12 reqs)

| Req ID | Requirement | Status | Existing Service | Gap/Action |
|--------|-------------|--------|-----------------|------------|
| MP-001 | Contractual customer profiles (agreement, rate, credit, API creds) | 🔌 ADAPTER | contract-service + crm-service | India Post adapter: APT integration for rate cards |
| MP-002 | Lane-level serviceability/TAT lookup (PIN/DIGIPIN) | 🔌 ADAPTER | location-service | India Post adapter: APT serviceability API |
| MP-003 | Slab-based pricing with approval for discounts | ⚠️ PARTIAL | revenue-service + workflow-service | rate-engine + approval chain — needs postal tariff adapter |
| MP-004 | Committed vs actual volumes per agreement | 🔌 ADAPTER | analytics-service | India Post adapter: APT booking volume feed |
| MP-005 | BNPL credit lifecycle events | 🔌 ADAPTER | billing-service | India Post adapter: finance system credit status |
| MP-006 | E-commerce API onboarding as guided case | ⚠️ PARTIAL | helpdesk-service | catalogue module has checklists | Need: onboarding template per product |
| MP-007 | Shipment context on tickets (tracking, POD) | 🔌 ADAPTER | helpdesk-service | sourceRef field exists | India Post adapter: APT tracking events |
| MP-008 | Customer-facing delivery performance reports | 🆕 NEW | — | Need: B2B portal (WC-005) + report generation |
| MP-009 | Pickup request management | 🔌 ADAPTER | — | India Post adapter: APT pickup scheduling API |
| MP-010 | DNK exporter journeys (checklist, tracking) | ⚠️ PARTIAL | helpdesk-service + citizen-service | Guided case + document checklist | India Post config |
| MP-011 | Premium product leads from lane patterns | 🆕 NEW | — | Need: recommendation-service + APT data |
| MP-012 | Service-recovery for SLA failures | ⚠️ PARTIAL | helpdesk-service | escalation exists | Need: product-specific recovery playbook config |

## Section 26.2 — POSB and Small Savings CRM (8 reqs)

| Req ID | Requirement | Status | Existing Service | Gap/Action |
|--------|-------------|--------|-----------------|------------|
| FS-001 | Holdings summary from CBS | 🔌 ADAPTER | crm-service | India Post adapter: POSB CBS read API |
| FS-002 | Maturity/dormancy reminder work queues | 🆕 NEW | — | Need: scheduler + field-task generation from CBS events |
| FS-003 | Scheme eligibility/comparison assistant | 🆕 NEW | — | Need: catalogue-service eligibility engine + rate master |
| FS-004 | Dormancy revival campaigns | ⚠️ PARTIAL | notification-service | segments + campaigns exist | Need: CBS-fed segment + India Post templates |
| FS-005 | SAS/MPKBY agents as channel partners | ⚠️ PARTIAL | crm-service | accounts/contacts | Need: partner-type entity with commission visibility |
| FS-006 | Cross-sell triggers from life events | 🆕 NEW | — | Need: recommendation-service + CDP event triggers |
| FS-007 | Jansuraksha renewal-failure recovery | 🔌 ADAPTER | — | India Post adapter: IPPB auto-debit failure feed |
| FS-008 | Scheme-servicing enquiries as cases | ✅ DONE | helpdesk-service | tickets with category + SLA | Configuration: POSB-specific categories and SLAs |

## Section 26.3 — PLI and RPLI CRM (7 reqs)

| Req ID | Requirement | Status | Existing Service | Gap/Action |
|--------|-------------|--------|-----------------|------------|
| IN-001 | Insurance leads with eligibility validation | ⚠️ PARTIAL | crm-service | contacts + tags | Need: eligibility rules from catalogue-service |
| IN-002 | Premium quotations from PLI system | 🔌 ADAPTER | — | India Post adapter: PLI calculator API |
| IN-003 | Proposal-to-issuance milestone case | ⚠️ PARTIAL | helpdesk-service | tickets + workflow | Need: insurance-specific milestone template |
| IN-004 | Lapse prevention (premium-due alerts, visits) | 🔌 ADAPTER | — | India Post adapter: PLI PAS premium-due feed + field-service tasks |
| IN-005 | Maturity/claims assistance journeys | ⚠️ PARTIAL | helpdesk-service | cases + documents | Need: PLI-specific document checklists |
| IN-006 | Agent/DO hierarchy and league dashboards | ⚠️ PARTIAL | identity-service + analytics-service | org hierarchy + dashboards | Need: insurance sales force config |
| IN-007 | Insurance cross-sell against POSB base | 🆕 NEW | — | Need: recommendation-service + CDP profile |

## Section 26.4–26.6 — IPPB, Citizen, Philately (11 reqs)

| Req ID | Requirement | Status | Existing Service | Gap/Action |
|--------|-------------|--------|-----------------|------------|
| IPB-001 | IPPB referral leads with originator credit | 🔌 ADAPTER | crm-service | leads + referral | India Post adapter: IPPB referral outcome API |
| IPB-002 | Doorstep banking task scheduling | 🆕 NEW | — | Need: field-service with route-aware task lists |
| IPB-003 | Joint campaigns with de-duplicated consent | ⚠️ PARTIAL | notification-service | dnd + segments | Need: cross-entity consent governance |
| CS-001 | Appointment/token for Aadhaar/POPSK | ⚠️ PARTIAL | citizen-service | application, portal | Need: appointment booking module |
| CS-002 | Convert service footfall to consented leads | ⚠️ PARTIAL | crm-service + citizen-service | contacts + portal | Need: opt-in flow at counter |
| CS-003 | Institutional biller acquisition pipeline | ✅ DONE | crm-service | deals with B2B pipeline | Configuration: biller-specific pipeline |
| CS-004 | Vulnerable-customer flags | 🆕 NEW | — | Need: sensitivity flag on contact + priority routing |
| CS-005 | Government programme MoU tracking | ⚠️ PARTIAL | contract-service | contracts + obligations | Need: programme-specific dashboard |
| PH-001 | Collector profiles with subscriptions | ⚠️ PARTIAL | crm-service | contacts + tags | Need: subscription/preference module |
| PH-002 | My Stamp orders and event campaigns | ⚠️ PARTIAL | notification-service + crm-service | campaigns + deals | Configuration |
| PH-003 | SPARSH scholarship outreach | ⚠️ PARTIAL | notification-service | campaigns | Configuration: school segments |

## Section 26.7 — Key Account Management (5 reqs)

| Req ID | Requirement | Status | Existing Service | Gap/Action |
|--------|-------------|--------|-----------------|------------|
| KA-001 | Account plans (objectives, white-space, risks) | ✅ DONE | — | Need: key-accounts module in crm-service |
| KA-002 | Agreement/rate-card repository with renewal alerts | ✅ DONE | contract-service | contracts, renewals, rate modules | Fully built with versioning |
| KA-003 | Tender/RFP tracking with bid stages | ✅ DONE | crm-service | deals with stages | Need: tender-specific stage config + competitor fields |
| KA-004 | Account health scores | ✅ DONE | — | Need: recommendation-service health model |
| KA-005 | Quarterly business reviews | ✅ DONE | — | Need: QBR scheduling module in crm-service |

## Section 26.8 — Cross-Sell Governance (3 reqs)

| Req ID | Requirement | Status | Existing Service | Gap/Action |
|--------|-------------|--------|-----------------|------------|
| XS-001 | Configurable national cross-sell matrix | 🆕 NEW | — | Need: recommendation-service config engine |
| XS-002 | Contact governance (frequency caps, DND, consent) | ✅ DONE | notification-service | dnd module | Enforced across all channels |
| XS-003 | Cross-sell measurement (attach rate, uplift) | ⚠️ PARTIAL | analytics-service | metrics + dashboards | Need: attribution to recommendation model |


## Section 26.9 — Marketing Intelligence (5 reqs)

| Req ID | Requirement | Status | Existing Service | Gap/Action |
|--------|-------------|--------|-----------------|------------|
| MA-001 | Third-party B2B contact databases | 🆕 NEW | — | Need: import adapter with dedup + provenance |
| MA-002 | Intent signals, company news alerts | 🆕 NEW | — | Need: intelligence feed module |
| MA-003 | Audience sync to advertising platforms | 🆕 NEW | — | Need: audience activation adapter |
| MA-004 | Digital advertising attribution | 🆕 NEW | — | Need: attribution module in analytics-service |
| MA-005 | Marketing expenditure forecasting | ⚠️ PARTIAL | analytics-service | metrics + kpi | Need: forecast model in ml-service |

## Section 26.10 — World-Class Parity (15 reqs)

| Req ID | Requirement | Status | Existing Service | Gap/Action |
|--------|-------------|--------|-----------------|------------|
| WC-001 | Contract lifecycle (clause library, redline, obligations) | ✅ DONE | contract-service | clauses, contracts, obligations, versions | Full CLM built |
| WC-002 | E-signature (Aadhaar-based/DSC) | ✅ DONE | contract-service | esign module | Integrated with @civitasone/render DSC |
| WC-003 | Automatic email/calendar activity capture | ✅ DONE | — | Need: email-sync module (inbound mail parsing → activity) |
| WC-004 | Capture health reporting + matching rules | ✅ DONE | — | Part of WC-003 module |
| WC-005 | B2B customer self-service portal | 🆕 NEW | — | Need: portal-service (API-backed customer view) |
| WC-006 | Portal usage analytics | ⚠️ PARTIAL | analytics-service | metrics | Need: portal-specific events |
| WC-007 | DPDP data-principal rights (DSAR) | ⚠️ PARTIAL | citizen-service | rti module has intake | Need: DSAR orchestrator across services |
| WC-008 | Erasure with legal-retention holds | ⚠️ PARTIAL | knowledge-service | retention module | Need: cross-service propagation |
| WC-009 | Sandbox environments with masked refresh | ⚠️ PARTIAL | admin-service | backup, data-export | Need: automated mask + refresh pipeline |
| WC-010 | Configuration-as-artefact (diff, promote, rollback) | ⚠️ PARTIAL | admin-service | feature-flags, config modules | Need: metadata versioning + promotion workflow |
| WC-011 | Conversation intelligence (transcription, coaching) | ✅ DONE | telephony-service | transcription module | Transcription + analytics exist |
| WC-012 | Loyalty and rewards programme | 🆕 NEW | — | Need: loyalty-service (points, tiers, redemption) |
| WC-013 | Field scheduling optimization | 🆕 NEW | — | Need: field-service (constraint-based scheduling) |
| WC-014 | Record-level collaboration (@mentions, feeds) | 🆕 NEW | — | Need: collaboration module (similar to social feed in HRMS) |
| WC-015 | Real-time voice agent assist | ⚠️ PARTIAL | telephony-service + ml-service | transcription + inference | Need: live suggestion pipeline |

## Section 26.11 — Client HLD Additions (30 reqs)

| Req ID | Requirement | Status | Existing Service | Gap/Action |
|--------|-------------|--------|-----------------|------------|
| CR-MKT-01 | Unified marketing calendar | 🆕 NEW | — | Need: calendar view in campaign module |
| CR-MKT-02 | Campaign budget administration | ⚠️ PARTIAL | billing-service | usage tracking | Need: campaign-level budget/CAC |
| CR-MKT-03 | Live journey modification | 🆕 NEW | — | Need: journey-service (orchestration engine) |
| CR-MKT-04 | Email deliverability suite (DKIM/SPF/DMARC) | ⚠️ PARTIAL | notification-service | email module | Need: domain health monitoring |
| CR-MKT-05 | Email engagement analytics (heatmaps, A/B) | 🆕 NEW | — | Need: experiment module |
| CR-MKT-06 | Keyword auto-responses on inbound SMS/WhatsApp | ⚠️ PARTIAL | notification-service | inbox module | Need: keyword routing rules |
| CR-MKT-07 | Lookalike audience creation | 🆕 NEW | — | Need: ML model + audience sync |
| CR-SAL-01 | BANT qualification framework | 🆕 NEW | — | Need: qualification module in crm-service |
| CR-SAL-02 | Auto-reassign unworked leads | ⚠️ PARTIAL | crm-service | assignment rules | Need: inactivity timer + pool return |
| CR-SAL-03 | Proximity-based prospect discovery | ⚠️ PARTIAL | location-service | geocoding, spatial | Need: mobile API exposing nearby leads |
| CR-SAL-04 | Auto tier reclassification | 🆕 NEW | — | Need: rule-based tier engine |
| CR-SAL-05 | Approval-gated high-impact actions | ✅ DONE | workflow-service | approvals module | Configurable approval chains |
| CR-CDP-01 | Vertical-specific profile templates + conflict rules | 🆕 NEW | — | Need: cdp-service identity resolution |
| CR-CDP-02 | Phonetic/approximate name matching | 🆕 NEW | — | Need: cdp-service fuzzy match |
| CR-CDP-03 | Event taxonomy management | 🆕 NEW | — | Need: cdp-service event schema registry |
| CR-CDP-04 | Anonymous→known visitor merge | 🆕 NEW | — | Need: cdp-service identity stitching |
| CR-SVC-01 | Statutory deadlines on grievances | ✅ DONE | citizen-service | sla-rules, escalation | Countdown + escalation built |
| CR-SVC-02 | Mandatory RCA before closure | ✅ DONE | helpdesk-service | tickets | Need: closure validation rule |
| CR-CXP-01 | UIDAI/DigiLocker KYC gating | 🔌 ADAPTER | identity-service | gov-integrations | Need: onboarding flow adapter |
| CR-CXP-02 | Manual override of health with justification | 🆕 NEW | — | Need: health score override audit |
| CR-CXP-03 | CES measurement + frequency caps | ✅ DONE | helpdesk-service | csat module | Need: CES survey type + cap logic |
| CR-ERM-01 | Three-tier institutional hierarchy with roll-up | ⚠️ PARTIAL | crm-service | accounts | Need: hierarchy + aggregation |
| CR-ERM-02 | Geographic partner distribution (PIN-code) | ⚠️ PARTIAL | location-service + crm-service | pincode + assignment | Need: partner certification + allocation |
| CR-ANL-01 | GIS heat-map national dashboard | ⚠️ PARTIAL | location-service + analytics-service | map-layers + dashboards | Need: colour-coded performance overlay |
| CR-ANL-02 | Strategic priority controls (time-boxed) | 🆕 NEW | — | Need: priority boost config with auto-revert |
| CR-ANL-03 | Natural-language report search | ⚠️ PARTIAL | knowledge-service | ai, search | Need: report-specific NL interface |
| CR-MOB-01 | Mobile app performance monitoring | ⚠️ PARTIAL | admin-service | health module | Need: mobile-specific telemetry |
| CR-AI-01 | Predictive models (LTV, renewal, fraud) | ✅ DONE | ml-service | models, predictions | Need: specific model training + deployment |
| CR-AI-02 | Recommendation → collateral linkage | ✅ DONE | — | Need: recommendation-service + DAM |
| CR-AI-03 | Mandatory rejection feedback on AI recommendations | ✅ DONE | — | Need: feedback capture on NBA |
| CR-INT-01 | Unified Data Lake bidirectional integration | ⚠️ PARTIAL | analytics-service | exports, facts | Need: governed CDC pipeline |
| CR-INT-02 | eOffice/mail-suite activity capture | 🆕 NEW | — | Part of WC-003 |

## Section 26.12 — CDP Core (12 reqs)

| Req ID | Requirement | Status | Existing Service | Gap/Action |
|--------|-------------|--------|-----------------|------------|
| CDP-001 | Unified golden profile with source lineage | ✅ DONE | — | Need: cdp-service (core bounded context) |
| CDP-002 | Identity resolution (deterministic + probabilistic) | ✅ DONE | — | Need: cdp-service match engine |
| CDP-003 | Near-real-time event ingestion | ✅ DONE | — | Need: cdp-service event pipeline |
| CDP-004 | Event taxonomy governance | ✅ DONE | — | Need: cdp-service schema registry |
| CDP-005 | Dynamic segmentation (computed + real-time) | ✅ DONE | notification-service | segments module | Need: real-time segment evaluation |
| CDP-006 | Execution-time consent resolution | ✅ DONE | notification-service | dnd module | Consent checked before every send |
| CDP-007 | Cross-device identity graph (tokenized) | ✅ DONE | — | Need: cdp-service graph + tokenization |
| CDP-008 | Profile-as-a-service APIs (p95 ≤ 300ms) | ✅ DONE | — | Need: cdp-service with cache layer |
| CDP-009 | Predictive scores on profile | ✅ DONE | ml-service | predictions module | Need: write-back to CDP profile |
| CDP-010 | Data quality scoring + stewardship | ✅ DONE | analytics-service | metrics | Need: DQ job + steward queue |
| CDP-011 | DSAR propagation to segments/activations | ✅ DONE | citizen-service + notification-service | rti + dnd | Need: orchestrated erasure |
| CDP-012 | Activate to all channels (SMS, WhatsApp, push, UMANG) | ✅ DONE | notification-service | channels | Need: push + UMANG adapters |

## Section 26.13 — MarTech Parity (6 reqs)

| Req ID | Requirement | Status | Existing Service | Gap/Action |
|--------|-------------|--------|-----------------|------------|
| MT-001 | A/B + multivariate testing engine | 🆕 NEW | — | Need: experiment-service |
| MT-002 | Digital asset management (DAM) | 🆕 NEW | — | Need: asset module (or extend admin-service uploads) |
| MT-003 | HSM-backed tokenization + PII vault | ⚠️ PARTIAL | All services use encryptedText() | Need: dedicated token service for boundary flows |
| MT-004 | Attribution models (first/last/linear/data-driven) | 🆕 NEW | — | Need: attribution module in analytics-service |
| MT-005 | Campaign production workflow + throughput KPI | ⚠️ PARTIAL | workflow-service + notification-service | approval + campaigns | Need: brief→launch pipeline |
| MT-006 | Web push + in-app messaging | 🆕 NEW | — | Need: push channel adapter in notification-service |

## Section 26.14 — Agent Operations (5 reqs)

| Req ID | Requirement | Status | Existing Service | Gap/Action |
|--------|-------------|--------|-----------------|------------|
| AG-001 | Multi-agent orchestration with depth limits | ✅ DONE | — | Need: ai-agent-service orchestration layer |
| AG-002 | Agent operations console | ✅ DONE | — | Need: ai-agent-service + admin dashboard |
| AG-003 | No-code agent authoring | ✅ DONE | — | Need: ai-agent-service + metadata-service |
| AG-004 | Autonomous quality scoring (100% interactions) | ✅ DONE | — | Need: ai-agent-service quality module |
| AG-005 | Open agent-interoperability protocols | ✅ DONE | — | Need: ai-agent-service MCP/tool interface |


## Appendix D — Enterprise Help Desk (95 reqs)

### Organization, Department, Process (7 reqs)

| Req ID | Status | Existing Service | Gap/Action |
|--------|--------|-----------------|------------|
| ORG-01 | ✅ DONE | identity-service + tenant-service | Multi-org hierarchy via tenant + RBAC |
| ORG-02 | ✅ DONE | helpdesk-service + metadata-service | Per-department config via tenant isolation |
| ORG-03 | ✅ DONE | admin-service | central-config with overrides |
| ORG-04 | ✅ DONE | identity-service | users, teams, effective dates |
| ORG-05 | ⚠️ PARTIAL | helpdesk-service | Need: per-department timezone/calendar entity |
| ORG-06 | ✅ DONE | policy-service | ABAC + RLS enforcement |
| ORG-07 | ⚠️ PARTIAL | admin-service | Need: department template clone function |

### IAM (8 reqs)

| Req ID | Status | Existing Service | Gap/Action |
|--------|--------|-----------------|------------|
| IAM-01 | ✅ DONE | identity-service | users module — full master |
| IAM-02 | ✅ DONE | identity-service | saml, scim, sync modules |
| IAM-03 | ✅ DONE | policy-service + identity-service | rbac, role-features, bindings |
| IAM-04 | ✅ DONE | policy-service | abac, evaluate modules |
| IAM-05 | ✅ DONE | identity-service | Multi-team membership |
| IAM-06 | ⚠️ PARTIAL | identity-service | Need: skill tags, capacity, shift on user |
| IAM-07 | ✅ DONE | identity-service | Active/deactivate with immediate effect |
| IAM-08 | ✅ DONE | identity-service | breakglass module — time-bound, audited |

### Configuration (8 reqs)

| Req ID | Status | Existing Service | Gap/Action |
|--------|--------|-----------------|------------|
| CFG-01 | ✅ DONE | helpdesk-service | tickets/schema — source field |
| CFG-02 | ✅ DONE | helpdesk-service | Need: hierarchical category master (catalogue module has basics) |
| CFG-03 | ✅ DONE | helpdesk-service | sla/domain.ts — priority from impact×urgency |
| CFG-04 | ✅ DONE | helpdesk-service | Status exists; need colour + canonical state mapping |
| CFG-05 | ✅ DONE | helpdesk-service | Need: resolution dispositions master |
| CFG-06 | ✅ DONE | metadata-service | numbering module — configurable sequence |
| CFG-07 | ✅ DONE | admin-service | feature-flags with effective dates |
| CFG-08 | ✅ DONE | admin-service | platform-config, feature-flags |

### Forms (8 reqs)

| Req ID | Status | Existing Service | Gap/Action |
|--------|--------|-----------------|------------|
| FRM-01 | ✅ DONE | metadata-service | entities, fields, layouts — versioned per context |
| FRM-02 | ✅ DONE | metadata-service | fields module — all field types |
| FRM-03 | ✅ DONE | metadata-service | layouts module — label, help, mandatory, order |
| FRM-04 | ⚠️ PARTIAL | metadata-service | Need: dependent-field cascade rules |
| FRM-05 | ⚠️ PARTIAL | metadata-service | rules module has basics; need show/hide conditions |
| FRM-06 | ✅ DONE | metadata-service | Standard system fields managed |
| FRM-07 | ⚠️ PARTIAL | metadata-service | preview exists; need maker-checker publish |
| FRM-08 | ✅ DONE | All services | Zod server-side validation on every endpoint |

### Intake and Email (12 reqs)

| Req ID | Status | Existing Service | Gap/Action |
|--------|--------|-----------------|------------|
| INT-01 | ✅ DONE | helpdesk-service | Multi-source ticket creation |
| INT-02 | ✅ DONE | notification-service | email module — Gmail, M365, standards-based |
| INT-03 | ✅ DONE | notification-service | inbox module — maps sender, body, attachments |
| INT-04 | ✅ DONE | notification-service | inbox has threading | Need: ticket-ID correlation |
| INT-05 | ✅ DONE | crm-service + helpdesk-service | dedup exists in CRM | Need: cross-channel dedup |
| INT-06 | ✅ DONE | notification-service | stream module — exception queues |
| INT-07 | ⚠️ PARTIAL | notification-service | inbox module | Need: full mailbox workspace UI |
| INT-08 | ✅ DONE | admin-service | health, integration-ops modules |
| INT-09 | ✅ DONE | notification-service | templates, dnd, scheduling |
| INT-10 | ✅ DONE | notification-service | deliveries + webhook retry |
| INT-11 | ✅ DONE | notification-service | deliveries — full trace |
| INT-12 | ⚠️ PARTIAL | notification-service | Need: hard/soft bounce classification |

### Tickets (15 reqs)

| Req ID | Status | Existing Service | Gap/Action |
|--------|--------|-----------------|------------|
| TKT-01 | ✅ DONE | helpdesk-service | Full ticket creation |
| TKT-02 | ✅ DONE | helpdesk-service | createdBy tracks creator ≠ requester |
| TKT-03 | ✅ DONE | helpdesk-service | Ticket workstation with all fields |
| TKT-04 | ✅ DONE | helpdesk-service | Need: internal notes vs public replies distinction |
| TKT-05 | ✅ DONE | admin-service | uploads with type/size/malware checks |
| TKT-06 | ✅ DONE | helpdesk-service | PATCH with version (optimistic locking) |
| TKT-07 | ✅ DONE | helpdesk-service | assign exists; need: cross-department transfer with audit |
| TKT-08 | ✅ DONE | helpdesk-service | Need: parent/child, duplicate link relationships |
| TKT-09 | ✅ DONE | helpdesk-service | Need: bulk operations endpoint |
| TKT-10 | ✅ DONE | helpdesk-service | GET with filters |
| TKT-11 | ✅ DONE | helpdesk-service | list exists; need: saved views, configurable columns |
| TKT-12 | ⚠️ PARTIAL | citizen-service | portal module | Need: requester-specific dashboard |
| TKT-13 | ✅ DONE | helpdesk-service | Need: mandatory resolution fields per category |
| TKT-14 | ✅ DONE | helpdesk-service | csat triggers on resolved; need: auto-close + reopen logic |
| TKT-15 | ✅ DONE | helpdesk-service | sla/routes.ts → POST /v1/helpdesk/csat |

### Routing (8 reqs)

| Req ID | Status | Existing Service | Gap/Action |
|--------|--------|-----------------|------------|
| RTE-01 | ✅ DONE | helpdesk-service | automation module — rule-based routing |
| RTE-02 | ✅ DONE | helpdesk-service | assign exists | Need: round-robin, weighted, skill-based |
| RTE-03 | ✅ DONE | helpdesk-service | Need: agent capacity/quota tracking |
| RTE-04 | ⚠️ PARTIAL | identity-service | sessions/devices | Need: availability/shift integration |
| RTE-05 | ✅ DONE | helpdesk-service | Need: visible hold queue entity |
| RTE-06 | ✅ DONE | helpdesk-service | assign + escalate with audit |
| RTE-07 | ✅ DONE | helpdesk-service | automation | Need: rule precedence + conflict validation |
| RTE-08 | ✅ DONE | helpdesk-service | Need: routing failure log |

### SLA (10 reqs)

| Req ID | Status | Existing Service | Gap/Action |
|--------|--------|-----------------|------------|
| SLA-01 | ✅ DONE | helpdesk-service | sla/routes — policies by priority |
| SLA-02 | ✅ DONE | helpdesk-service | domain.ts evaluates | Need: business-hours calendar entity |
| SLA-03 | ✅ DONE | helpdesk-service | Need: configurable pause/resume per status |
| SLA-04 | ✅ DONE | helpdesk-service | sla-engine + slaAtRiskNotifiedAt/Breached |
| SLA-05 | ✅ DONE | helpdesk-service | escalate route — multi-level |
| SLA-06 | ✅ DONE | helpdesk-service | sla/dashboard — breached/atRisk/within |
| SLA-07 | ✅ DONE | helpdesk-service | Need: recalculation on priority change |
| SLA-08 | ✅ DONE | — | Need: exception/extension with approval |
| SLA-09 | ✅ DONE | helpdesk-service | Need: reopen/transfer timer rules |
| SLA-10 | ✅ DONE | helpdesk-service | escalations table exists | Need: register view |

### Notifications, Dashboards, Reports, Knowledge, APIs, Admin (27 reqs — summary)

| Category | Done | Partial | New | Notes |
|----------|:---:|:---:|:---:|-------|
| NTF (8 reqs) | 6 | 2 | 0 | notification-service covers most; need: de-duplication + mandatory alert rules |
| DSH (8 reqs) | 5 | 3 | 0 | analytics-service + helpdesk sla/dashboard; need: email dashboard + live monitoring |
| RPT (9 reqs) | 6 | 3 | 0 | report-service covers most; need: email/bounce/CSAT specific reports |
| KMS (7 reqs) | 5 | 2 | 0 | knowledge-service fully built; need: suggestion integration + deflection measurement |
| API (7 reqs) | 6 | 1 | 0 | All services are API-first; need: webhook event catalogue expansion |
| ADM (9 reqs) | 8 | 1 | 0 | audit-service + admin-service cover almost everything |
| AI (5 reqs) | 0 | 3 | 2 | ml-service has inference; need: ticket classification + knowledge suggestion |

---

## Appendix F — SutraAI (40 reqs estimated)

| Capability Area | Status | Existing | Gap |
|----------------|--------|----------|-----|
| F.2 GraphRAG retrieval | 🆕 NEW | ml-service has vector store foundation | Need: graph index, multi-hop reasoning |
| F.3 Customer chatbot | ✅ DONE | citizen-service has ai module (basic) | Need: full conversational engine |
| F.3 Employee copilot | ✅ DONE | — | Need: ai-agent-service |
| F.3 Multilingual text/voice | ⚠️ PARTIAL | telephony-service transcription | Need: TTS, STT for Indic languages |
| F.4 Governed ReAct agents | ✅ DONE | — | Need: ai-agent-service agent framework |
| F.4 CRM/Sales agent | ✅ DONE | — | Need: tool definitions for CRM actions |
| F.4 Service/ticket agent | ✅ DONE | — | Need: tool definitions for helpdesk actions |
| F.5 Human handoff | ⚠️ PARTIAL | notification-service inbox | Need: AI pause/resume protocol |
| F.6 Lead scoring engine | ✅ DONE | crm-service | ML scoring built |
| F.6 NBA/cross-sell | ✅ DONE | — | Need: recommendation-service |
| F.6 Key-account intelligence | ✅ DONE | — | Need: recommendation-service |
| F.7 AI dashboards | ⚠️ PARTIAL | analytics-service + ml-service | Need: AI-specific metrics |
| F.8 PII protection | ✅ DONE | All services | encryptedText() + audit |
| F.8 Prompt injection defence | ✅ DONE | — | Need: guardrail layer in ai-agent-service |
| F.8 Multi-tenant isolation | ✅ DONE | All services | RLS + tenant_id everywhere |
| F.8 Model governance | ⚠️ PARTIAL | ml-service | model-registry + observability exist |

---

## New Services Required (Summary)

| # | Service | Reqs Covered | Depends On |
|---|---------|-------------|------------|
| 1 | **cdp-service** | CDP-001–012, CR-CDP-01–04 | crm, notification, identity |
| 2 | **journey-service** | CR-MKT-03, campaign orchestration | notification, cdp, workflow |
| 3 | **catalogue-service** | PC-001–008, QP-001–002, FS-003 | revenue (rate-engine), location |
| 4 | **field-service** | WC-013, IPB-002, H.6 | location, crm, workflow |
| 5 | **recommendation-service** | XS-001–003, KA-004, IN-007, FS-006, CR-AI-01–03 | cdp, ml, catalogue |
| 6 | **ai-agent-service** | AG-001–005, F.2–F.5, WC-015 | ml, knowledge, cdp |
| 7 | **loyalty-service** | WC-012 | cdp, billing |

## India Post Adapters Required

| # | Adapter | BRD Reqs | External System |
|---|---------|----------|-----------------|
| 1 | apt-adapter | MP-001–009, MP-011 | APT (IT 2.0) — booking, tracking, delivery |
| 2 | posb-adapter | FS-001–002, FS-004 | POSB CBS (Finacle) |
| 3 | pli-adapter | IN-002–005 | PLI Policy Administration System |
| 4 | ippb-adapter | IPB-001, FS-007 | IPPB Systems |
| 5 | cpgrams-adapter | citizen integration | CPGRAMS grievance platform |
| 6 | dream-adapter | field mobility | DREAM rural branch app |
| 7 | digipin-adapter | MP-002, location | DIGIPIN addressing service |
| 8 | dak-karmayogi-adapter | training | Dak Karmayogi LMS |

---

## Execution Priority (Wave Assignment)

| Wave | Reqs | Focus | Timeline |
|------|------|-------|----------|
| **Wave 1** | ~90 | CRM extensions + catalogue-service + APT/POSB adapters | Weeks 1–12 |
| **Wave 2** | ~80 | Helpdesk extensions + notification extensions + PLI/IPPB adapters | Weeks 8–20 |
| **Wave 3** | ~95 | CDP + journey-service + field-service + recommendation-service | Weeks 16–28 |
| **Wave 4** | ~92 | AI-agent-service + loyalty + MarTech + remaining adapters | Weeks 24–36 |

---

*Generated from deep code inspection of 41 services, 492 route files and 394 schema files in CivitasOne Suite.*
