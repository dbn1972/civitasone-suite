# CivitasOne Universal Service Designer — Business Requirements Document

**Date:** 2026-08-07 · **Author:** CivitasOne product/engineering (continued from Service Studio BRD draft)  
**Audience:** engineering executors building inside `civitasone-suite`; product, functional, and statutory stakeholders reviewing scope.  
**Status:** build-executable BRD — no application code in this document.

**Grounding:** every "existing building block" path below was verified against the `civitasone-suite` repository on 2026-08-07. Municipal field/workflow/payment claims were verified against UPYOG Java models (NIUA/DIGIT lineage) on 2026-08-07 — UPYOG is a live ULB reference, not hypothetical.

**How to use this document:** §6 is the buildable spec — each FN has an ID, phase, actors, trigger, flow, business rules, and mapping to existing files/schemas/APIs or a net-new note. §7 grounds the abstract designer in concrete domain packs, with **Municipal/ULB first**. §9 maps reuse to real repo paths. An executor should be able to implement one FN without outside product input.

**Companion documents:** Implementation of any FN (FN-01–FN-33) **must** satisfy **both** this BRD and [`CIVITASONE-UNIVERSAL-SERVICE-DESIGNER-UX.md`](./CIVITASONE-UNIVERSAL-SERVICE-DESIGNER-UX.md). **Conflict rule:** this BRD wins on **function** (what each screen must do); the UX spec wins on **presentation and interaction** (how it looks and behaves).

---

## 1. Vision

Any government department — municipal licensing, state revenue, police permissions, health registrations, school admissions, or general admin clearances — should be able to take a service from idea to citizen-facing and back-office reality **without writing code**: compose the form, decide who approves and in what order, decide what it costs and how money is collected and posted, decide what is handed back to the applicant — using the **same eight composition blocks** for a fire-NOC renewal as for a school transfer certificate or a police character certificate.

Engineering builds the **Universal Service Designer** once. Every office composes services after that.

Two things must both be true for this to be world-class rather than a toy:

1. **Universal composition** — the 8-block model and four Service Patterns must cover 60–70% of government services across sectors without an engineer in the loop.
2. **Honest domain boundaries** — property assessment, metered utilities, plan scrutiny, statutory registrar systems, and police verification backends need **engineered domain logic**. The Designer parameterises those domains via **Domain Packs** and **Engine Bindings**; it does not pretend to replace them.

**Phase 0 anchor:** Municipal/ULB is the **first-class Domain Pack** — not a special case bolted on later. Trade License, Water Connection, PGR, Fire NOC, and Property Tax / Birth-Death **parameters** ship as the reference pack set that proves universality. Other sectors reuse the same blocks with different packs.

---

## 2. Relationship to the Municipal / Service Studio BRD

This document **supersedes and extends** `CIVITASONE-SERVICE-STUDIO-BRD-2026-08-07.md` (the "Service Studio BRD"):

| Service Studio concept | Universal Service Designer evolution |
|---|---|
| **Archetype** (4 types) | Renamed **Service Pattern** — same four shapes, sector-agnostic labels |
| **Service Pack** | Retained as **Pack** — versioned exportable bundle |
| — | New **Domain Pack** — sector template library (Municipal, Revenue, Police, …) containing pre-built Packs + Engine Bindings |
| — | New **Engine Binding** — explicit link from a Pack block to an engineered backend (rate engine, assessment, verification API) |
| **ownerDepartment** (free text) | **Owning Office** — FK to org hierarchy + optional offering offices |
| FN-01–FN-18 | Preserved and renumbered in spirit; expanded to **FN-01–FN-33** with cross-sector and governance FNs |
| Municipal §6 services only | §7 Domain Packs — Municipal first, then Revenue/Police/Health/Education/General Admin |

**Nothing in the municipal BRD is abandoned.** Trade License, Water, PGR, Fire NOC, Property Tax parameters, and Birth/Death parameters remain the Phase 0 pilot set with UPYOG-verified field shapes. The universal layer adds vocabulary and cross-sector packs without rewriting municipal requirements.

---

## 3. Actors

| Actor | Role |
|---|---|
| **Service Designer** | Authors service definitions across the 8 blocks. Cannot publish alone. Scoped to Owning Office. |
| **Department Head / Approver (checker)** | Reviews and publishes/rejects submitted services (maker ≠ checker). |
| **Tenant / Platform Admin** | Cross-department governance: Service Pattern library, Domain Pack import approval, statutory policy, org setup. |
| **Domain Pack Curator** (Platform or state-level) | Maintains sector pack libraries (Municipal pack v2, Police CC pack, …). Exports/importable manifests with statutory references. |
| **Field Officer / Approver-in-workflow** | Acts on live applications per published workflow — not a Designer actor, but the reason workflow steps must produce **working** runtime instances. |
| **Citizen / Company / Institutional Applicant** | Consumes published services via pack-driven application runtime. |
| **Counter / CSC Operator** | Assisted-service channel — submits on behalf of applicant with attribution (`assistedBy`). |
| **Finance Reviewer** | Validates fee schedules, HOA mapping, and GL posting in Test before publish. |
| **Auditor** | Read-only access to every pack version, publish decision, fee change — statutory accountability. |

---

## 4. Canonical Concepts

### 4.1 Service Pattern

One of four workflow shapes that fix which 8-block steps apply and how the wizard adapts:

| Pattern | Typical use | Fee step | Output |
|---|---|---|---|
| **Certificate / Permission** | Licences, NOCs, registrations, character certificates | Yes (usually post-approval) | Signed certificate / licence |
| **Booking / Reservation** | Hall booking, slot allocation, appointment | Often upfront | Confirmation / pass |
| **Collection (fee-only)** | Self-assessment, fee payment without approval gate | Yes (primary step) | Receipt / acknowledgement |
| **Grievance / Case** | Complaints, RTI-adjacent cases, service requests | No (default) | Resolution note / closure |

Service Studio's "Archetype" maps 1:1 — this BRD uses **Service Pattern** for cross-sector clarity (police "permission" and municipal "permission" share the same pattern).

### 4.2 Domain Pack

A **versioned, importable library** for a sector or jurisdiction: pre-composed Packs, code lists, statutory references, default Engine Bindings, and onboarding activation steps. Examples: `domain-pack:municipal-in`, `domain-pack:revenue-gst`, `domain-pack:police-general`.

A Domain Pack is **not** a runtime service — it is a **starter kit** that clones into tenant drafts via import (never auto-published).

### 4.3 Pack (Service Pack)

A versioned, exportable bundle referencing one Service Definition plus its 8-block attachments: form, eligibility, fee, workflow, documents, certificate/output template, notifications, Engine Bindings. One department builds a Pack; another department or tenant imports it as a draft.

Proposed home: new `packs` sub-module in `citizen-service`, adjacent to `catalogue`.

### 4.4 Engine Binding

An explicit, typed link from a Pack block to **engineered backend logic** the Designer does not author:

```text
engineBinding:
  block: "fee" | "assessment" | "verification" | "numbering" | "inspection"
  engineKey: "revenue.rate-engine" | "revenue.assessment" | "inspection.planning" | ...
  configRef: uuid | jsonb   # Studio-editable parameters only
  requiredForPublish: boolean
```

**Honesty rule:** if `engineKey` points to a missing or stub engine, the Pack cannot pass Sandbox Test (FN-10). Studio exposes **parameters**; engineering owns **engines**.

### 4.5 Owning Office

The organisational unit accountable for a service definition:

- **Owner:** single FK → `tenant-service/org-hierarchy` (replaces free-text `ownerDepartment` on `serviceDefinitions`).
- **Offering offices:** optional list — service designed centrally, offered/customised per zonal office (different fee ward-wise, same pack).
- **Scope:** Service Designers see/edit only services for offices their role permits.

### 4.6 Application

An applicant's instance of a published Service Definition. Existing entity: `citizen-service/application` → `application.citizen_applications` (verify extensions: `serviceDefinitionVersion`, `parentApplicationId`, `formData` jsonb, `applicantType`).

### 4.7 Demand

Payable-amount record when an application must pay. UPYOG-verified shape (`billing-service` Demand model): `consumerCode`, `businessService`, `demandDetails[]` with `taxHeadCode` + amount — one demand, multiple typed lines (base + penalty + rebate).

---

## 5. The 8-Block Model

Every service — municipal or cross-sector — is composed from eight blocks. The Designer wizard walks blocks in order; blocks may be **skipped** per Service Pattern (e.g. Grievance skips fee).

| Block | Purpose | Primary reuse |
|---|---|---|
| **B1 — Catalogue & Identity** | Service key, name, pattern, Owning Office, channels, SLA, statutory refs | `citizen-service/catalogue` |
| **B2 — Intake Form** | Applicant-facing fields, sections, validation, conditional logic | `metadata-service` forms/fields/layouts/composition/preview |
| **B3 — Eligibility** | Pre-workflow gates on applicant attributes + form answers | `citizen-service/eligibility` |
| **B4 — Workflow** | Approval graph, designation assignment, SLA per lane, inspection branches | `workflow-service` designer/BPMN/DMN/SLA/workbaskets |
| **B5 — Fee & Revenue** | Flat or slab fee, exemptions, HOA mapping, demand trigger state | `citizen-service/fee-payment`, `revenue-service/rate-engine`, `metadata-service/formula`, `finance-service/hoa` |
| **B6 — Documents & Evidence** | Required uploads, formats, verification lane | `serviceDefinitions.requiredDocuments`, `citizen-service/documents` |
| **B7 — Output & Issuance** | Certificate/closure note, numbering, QR verify, signatory | `citizen-service/issuance`, `metadata-service/numbering` |
| **B8 — Notifications & Channels** | Lifecycle templates per event × channel | `notification-service/templates`, channels |

**Runtime rule (FN-13):** one generic applicant runtime renders all blocks from the published Pack — no per-service frontend code.

---

## 6. Canonical Data Flow

Universal flow every Service Pattern specialises:

1. **Discover** — browse `citizen-service/catalogue` published list; route via `citizen-service/eligibility` or `discovery`.
2. **Apply** — submit Studio-built form; attach documents; create `Application`, `status=submitted`.
3. **Eligibility gate** (optional) — rule-set evaluates attribute bag; block/warn/flag before workflow.
4. **Workflow** — `workflow-service` instance from pack's `workflowDefinitionId`; designation-based assignment via `tenant-service/positions`.
5. **Engine hooks** (optional) — Engine Bindings invoke assessment, inspection, or verification backends at configured states.
6. **Fee & Demand** — at pack-defined trigger; amount via flat schedule, slab/formula, or bound engine; HOA from pack.
7. **Payment & Collection** — gateway/BBPS/counter; receipt against `consumerCode`; **GL posting mandatory** (`finance-service/gl`).
8. **Issue** — on completion + payment; `citizen-service/issuance` generates output from template.
9. **Track / Verify / Renew** — status tracking; QR verify; renewal/amendment/surrender sub-flows (FN-15).

Every FN below is an **authoring** control over one or more steps.

---

## 7. Functional Requirements (FN-01 – FN-33)

Each FN lists **Phase:** 0 | 1 | 2 | 3 (see §11 Roadmap).

### Block B1 — Catalogue & Identity

#### FN-01 — Service Catalogue Authoring
**Phase:** 1 · **Actor:** Service Designer · **Trigger:** "New Service" / "Edit Draft"

**Flow:** create/edit draft `serviceDefinitions` → save draft → Submit (locks, routes to checker) → Publish (increments version, `status=published`) or Reject.

**Rules:** `serviceKey` unique per tenant; new version must not break in-flight applications (applications pin `serviceDefinitionVersion`).

**Building blocks:** `services/citizen-service/src/modules/catalogue/{schema,routes,commands,repo,domain}.ts` — APIs exist for create/submit/publish. **Gap:** UI — `apps/web/src/app/(app)/citizen/catalogue/page.tsx` is read-only.

**Acceptance:** Designer creates draft, submits; different Department Head publishes via UI with audit trail.

---

#### FN-12 — Owning Office & Department Scoping
**Phase:** 1 · **Actor:** Tenant Admin, Service Designer

**Flow:** bind `ownerOfficeId` FK → `tenant-service/org-hierarchy`; optional `offeringOffices[]`; role-scoped catalogue filtering.

**Building blocks:** `services/tenant-service/src/modules/org-hierarchy/{schema,routes,repo}.ts`, `services/tenant-service/src/modules/positions/{schema,routes,repo}.ts`. **Gap:** FK on catalogue schema + UI scoping.

**Acceptance:** Sanitation user cannot edit Licensing-owned draft; can read published catalogue entry.

---

#### FN-19 — Service Pattern Selection & Wizard Adaptation
**Phase:** 1 · **Actor:** Service Designer · **Trigger:** "New Service"

**Flow:** pick Service Pattern at creation; wizard shows/skips blocks (Grievance hides B5 default; Collection minimises B4).

**Building blocks:** extend `catalogue/domain.ts` with `servicePattern` enum. **Gap:** pattern registry + wizard shell (FN-33).

**Acceptance:** switching pattern visibly changes available blocks without data loss on draft.

---

#### FN-24 — Channel Configuration
**Phase:** 2 · **Actor:** Service Designer

**Flow:** enable channels per service: portal, mobile, CSC/counter, WhatsApp handoff, API; store on `serviceDefinitions.channels`.

**Building blocks:** `catalogue/schema.ts` `channels` jsonb exists. **Gap:** channel editor UI; runtime routing in `application/intake.ts`.

**Acceptance:** service published portal-only rejects mobile submission with clear error.

---

### Block B2 — Intake Form

#### FN-02 — Form & Field Builder
**Phase:** 1 · **Actor:** Service Designer · **Trigger:** "Edit Application Form"

**Flow:** compose fields (text, number, date, file, select, address, ward/jurisdiction) into sections; validation; conditional visibility; preview; save as `formId`.

**Rules:** field types from fixed registry; address/ward bind to `location-service/hierarchy`, not free text.

**Building blocks:** `services/metadata-service/src/modules/{entities,fields,forms,layouts,composition,preview}/`. **Gap:** UI — `apps/web/src/app/(app)/metadata/forms/page.tsx` is JSON dump. **Largest single build item.**

**Acceptance:** 10-field form with 2 file uploads and 1 conditional field built without code; renders in citizen runtime.

---

#### FN-18 — Localization (Form, Certificate, Notifications)
**Phase:** 3 · **Actor:** Service Designer

**Flow:** per-locale strings on all text-bearing blocks; runtime renders applicant language.

**Building blocks:** `services/notification-service/src/modules/i18n/` exists; no platform-wide localization service equivalent to UPYOG `egov-localization`. **Gap:** follow-up architecture decision before estimate.

**Acceptance:** English + Hindi labels on same form definition.

---

#### FN-32 — Accessibility & GIGW Preview
**Phase:** 3 · **Actor:** Service Designer

**Flow:** preview block runs WCAG 2.1 AA checks on generated form (labels, contrast hints, focus order); GIGW bilingual warning if secondary locale missing.

**Building blocks:** net-new preview harness atop metadata preview. **Gap:** full a11y audit tooling.

**Acceptance:** form missing labels fails preview with actionable list.

---

### Block B3 — Eligibility

#### FN-03 — Eligibility Rule Builder
**Phase:** 1 · **Actor:** Service Designer · **Trigger:** "Edit Eligibility" (skippable)

**Flow:** ordered rules: attribute + operator + value + effect (block/warn/flag); preview against sample applicant.

**Building blocks:** `services/citizen-service/src/modules/eligibility/domain.ts` (`evaluateRule`). **Gap:** authoring UI — only checker at `apps/web/.../citizen/eligibility/page.tsx`.

**Acceptance:** "ward within municipal limits" blocks out-of-ward sample in preview.

---

#### FN-23 — Applicant Identity Types
**Phase:** 2 · **Actor:** Service Designer

**Flow:** configure allowed applicant types: citizen, company, institution, anonymous (Grievance-only); bind profile attribute registry.

**Building blocks:** extend application schema + intake domain. **Gap:** company profile integration via `crm-service` or citizen registry.

**Acceptance:** company-only service rejects citizen profile with configured message.

---

### Block B4 — Workflow

#### FN-05 — Workflow Builder
**Phase:** 1 · **Actor:** Service Designer · **Trigger:** "Edit Workflow"

**Flow (template):** Service Pattern lane template → assign **designations** from `tenant-service/positions`; SLA per lane; optional parallel inspection branch.

**Flow (advanced):** BPMN canvas + DMN conditional routing.

**Building blocks:** `services/workflow-service/src/modules/{designer,bpmn,dmn,sla,workbaskets,definitions}/`; UI at `apps/web/src/app/(app)/workflow/designer/_components/{DesignerCanvas,BpmnPalette,PropertyPanel,ValidationIndicators}.tsx`. **Gap:** pattern-template layer (pre-populate canvas; designation not named person).

**Acceptance:** Permission pattern with Inspector + Officer designations routes test app to any Inspector holder.

---

#### FN-25 — SLA & Escalation Rules
**Phase:** 2 · **Actor:** Service Designer

**Flow:** per-lane SLA days; escalation to superior designation on breach; link to `citizen-service/sla-rules` and `citizen-service/escalation`.

**Building blocks:** `services/citizen-service/src/modules/sla-rules/`, `services/workflow-service/src/modules/sla/`. **Gap:** pack-level binding UI.

**Acceptance:** breached lane triggers escalation notification in sandbox test.

---

#### FN-26 — Document Verification Lane Integration
**Phase:** 2 · **Actor:** Service Designer

**Flow:** map each required document to workflow lane that verifies; inspector checklist in workbasket.

**Building blocks:** `requiredDocuments` jsonb + `workflow-service/tasks`. **Gap:** verification checklist UI in officer workbasket.

**Acceptance:** inspector sees mandatory doc checklist at Inspect lane.

---

### Block B5 — Fee & Revenue

#### FN-04 — Fee / Rate Builder
**Phase:** 1 · **Actor:** Service Designer + Finance reviewer · **Trigger:** "Edit Fee"

**Flow:** choose `feeModel`: **flat** (`citizen-service/fee-payment` / `feeSchedules`) or **slab** (`revenue-service/rate-engine` / `rateSlabs` + `metadata-service/formula`). Map HOA from `finance-service/hoa`. Preview sample amounts.

**Rules:** `feeModel` stored explicitly on pack — no unlabeled dual paths.

**Building blocks:** `services/citizen-service/src/modules/fee-payment/schema.ts`, `services/revenue-service/src/modules/rate-engine/schema.ts`, `services/metadata-service/src/modules/formula/domain.ts`, `services/finance-service/src/modules/hoa/schema.ts`. UI pattern: `apps/web/src/app/(app)/revenue/config/RateConfigConsole.tsx`. **Gap:** generic service-linked fee builder + HOA column.

**Acceptance:** flat ₹500 with 50% micro-enterprise exemption previews correctly; HOA attached.

---

#### FN-14 — Payment & Financial Integration
**Phase:** 0 · **Actor:** system, Citizen, Finance

**Flow:** Demand in UPYOG shape; pay via `billing-service` gateways or `revenue-service/bbps`; receipt; **GL journal on payment confirmation** using pack HOA.

**Rules:** pack cannot publish without HOA mapping; sandbox payment must produce GL entry. Closes UAT P2 "revenue never posts to GL."

**Building blocks:** `services/billing-service/src/modules/payments/`, `services/revenue-service/src/modules/bbps/`, `services/finance-service/src/modules/gl/{schema,commands,consumer}.ts`. **Gap:** payment-confirmed → GL consumer (critical).

**Acceptance:** test payment yields balanced GL entry in same sandbox run.

---

#### FN-21 — Engine Binding Configuration (Fee / Assessment)
**Phase:** 2 · **Actor:** Service Designer, Domain Pack Curator

**Flow:** for Collection pattern or municipal PT: bind B5 to `revenue.assessment` or external engine; Studio edits exemptions, penalty/rebate, HOA only.

**Building blocks:** `services/revenue-service/src/modules/assessment/`, `services/revenue-service/src/modules/rate-engine/domain.ts`. **Gap:** binding schema on pack + admin UI.

**Acceptance:** PT pack exposes exemption categories but assessment compute stays in engine; changing exemption in Studio affects preview via engine API.

---

### Block B6 — Documents

#### FN-06 — Document Checklist & Verification Config
**Phase:** 1 · **Actor:** Service Designer · **Trigger:** "Edit Documents"

**Flow:** add documents (name, format, max size, mandatory/optional, verification lane).

**Building blocks:** `catalogue/schema.ts` `requiredDocuments`; `services/citizen-service/src/modules/documents/`. **Gap:** list-editor UI only.

**Acceptance:** "Shop Rent Agreement PDF 5MB mandatory Inspect lane" appears on citizen upload and inspector checklist.

---

### Block B7 — Output & Issuance

#### FN-07 — Certificate / Output Template & Numbering
**Phase:** 1 · **Actor:** Service Designer · **Trigger:** "Edit Certificate"

**Flow:** template with dynamic fields, QR verify, signatory designation; numbering e.g. `TL/{ward}/{year}/{seq:5}`.

**Building blocks:** `services/citizen-service/src/modules/issuance/{schema,routes,domain}.ts`, `services/metadata-service/src/modules/numbering/`. Verify UI: `apps/web/.../citizen/certificates/CertificateVerify.tsx`. **Gap:** authoring UI.

**Acceptance:** test certificate from sample data; QR resolves.

---

#### FN-15 — Renewal / Amendment / Surrender Lifecycle
**Phase:** 3 · **Actor:** Service Designer, Applicant

**Flow:** pattern toggle "Renewable"; renewal window; lighter form prefilled; optional shortened workflow; `parentApplicationId` linkage.

**Building blocks:** `application/schema.ts` needs `parentApplicationId`; workflow separate definitions. **Gap:** renewal config block in wizard.

**Acceptance:** Trade License renewal prefills and blocks outside window.

---

### Block B8 — Notifications

#### FN-08 — Notification Template Config
**Phase:** 2 · **Actor:** Service Designer · **Trigger:** "Edit Notifications"

**Flow:** per lifecycle event × channel (SMS/WhatsApp/email/in-app); merge fields.

**Building blocks:** `services/notification-service/src/modules/templates/{schema,routes,commands}.ts`, `services/notification-service/src/modules/channels/`. **Gap:** per-service binding join table + UI.

**Acceptance:** payment-due WhatsApp with amount + pay link fires in staging test.

---

### Cross-block — Packs, Domain Packs, Runtime

#### FN-09 — Pack Export / Import / Library
**Phase:** 2 · **Actor:** Service Designer, Platform Admin · **Trigger:** Export / Import

**Flow:** export published service → versioned JSON manifest; import clones as **draft** (never auto-publish); cross-tenant import needs Platform Admin approval; statutory refs surfaced as warnings.

**Building blocks:** **net-new** `citizen-service/modules/packs/`. **Gap:** full module.

**Acceptance:** Trade License pack Tenant1 DeptA → import Tenant2 Sanitation → edit fee → publish locally.

---

#### FN-20 — Domain Pack Registry
**Phase:** 0 · **Actor:** Domain Pack Curator, Platform Admin

**Flow:** register Domain Packs (`municipal-in-v1`, …) containing multiple Packs + code lists + default Engine Bindings; browse/activate during onboarding (FN-17).

**Building blocks:** extends FN-09 manifest with `domainPackKey`, sector, jurisdiction. **Gap:** registry schema + library UI.

**Acceptance:** activate `municipal-in-v1` imports TL + PGR + Water drafts in one action.

---

#### FN-10 — Validation & Sandbox Test
**Phase:** 2 · **Actor:** Service Designer, Department Head · **Trigger:** "Run Test" before Submit

**Flow:** synthetic application through full pack — form, eligibility, workflow lanes, demand, mock payment, GL check, certificate — pass/fail per step with artifacts.

**Rules:** Submit blocked until latest Test passed on current draft.

**Building blocks:** composes catalogue/eligibility/workflow/fee/issuance; **Gap:** orchestration + dry-run flags on composed APIs.

**Acceptance:** broken fee formula fails Test with actionable error; Submit blocked.

---

#### FN-13 — Pack-Driven Application Runtime
**Phase:** 2 · **Actor:** Applicant · **Trigger:** select published service

**Flow:** generic runtime renders B2–B8 from pack; no per-service frontend.

**Building blocks:** partial — `apps/web/.../citizen/intake/IntakePanel.tsx`, `application/intake-domain.ts`. **Gap:** full pack-driven renderer (major).

**Acceptance:** Trade License (12 fields, 3 docs) and Hall Booking (4 fields, no docs) same code path.

---

#### FN-33 — Designer Shell & 8-Block Wizard
**Phase:** 2 · **Actor:** Service Designer

**Flow:** unified Studio UI: progress across B1–B8, validation indicators, Test gate, Submit/Publish; deep-links to existing consoles where built (workflow designer, rate config).

**Building blocks:** net-new `apps/web/.../designer/` (proposed). **Gap:** full shell.

**Acceptance:** designer completes all blocks without leaving wizard except intentional advanced BPMN.

---

### Governance, Reporting, Integration

#### FN-11 — Maker-Checker, Versioning, Audit
**Phase:** 1 · **Actor:** Platform Admin, Department Head, Auditor

**Flow:** maker ≠ checker server-side; immutable versions; Auditor read-only history.

**Building blocks:** `catalogue/schema.ts` has `submittedBy`/`publishedBy`/`version`/`rowVersion`; `services/audit-service/`. **Gap:** enforce maker≠checker in commands; Auditor role view.

**Acceptance:** same user submit+publish rejected with clear error.

---

#### FN-16 — Reporting & Analytics per Service
**Phase:** 3 · **Actor:** Department Head, Finance, Auditor

**Flow:** auto-attach archetype-keyed reports: issued register, pending/SLA breach, revenue vs demand.

**Building blocks:** `services/report-service/src/modules/templates/`. **Gap:** pattern-keyed templates; fix empty report rows (UAT #23) first.

**Acceptance:** new Certificate pack gets working Issued Register without extra config.

---

#### FN-17 — Onboarding Wizard Integration
**Phase:** 2 · **Actor:** ULB/Tenant Admin · **Trigger:** install Stage 3

**Flow:** browse Domain Pack library; activate packs → import drafts for local review.

**Building blocks:** `services/install-service/src/modules/{orchestrator,provisioning,stages}/`. **Gap:** stage-step engine + activate-pack action.

**Acceptance:** onboarding activation yields editable TL draft in catalogue same session.

---

#### FN-27 — Appeal & Grievance Linkage
**Phase:** 3 · **Actor:** Service Designer

**Flow:** optional link from Certificate services to appeal path; Grievance pattern wraps `citizen-service/grievance`.

**Building blocks:** `services/citizen-service/src/modules/grievance/`, `services/citizen-service/src/modules/appeal/`. **Gap:** pack linkage config.

**Acceptance:** PGR retrofit pack uses existing grievance module as runtime backend.

---

#### FN-28 — RTI / Transparency Hooks
**Phase:** 3 · **Actor:** Service Designer, Auditor

**Flow:** optional publish service metadata to RTI catalogue; auto-redact PII in exported summaries.

**Building blocks:** `services/citizen-service/src/modules/rti/`. **Gap:** designer toggle + export job.

**Acceptance:** enabled service appears in RTI service list export.

---

#### FN-29 — Compliance & Statutory Manifest
**Phase:** 2 · **Actor:** Domain Pack Curator, Platform Admin

**Flow:** pack manifest carries `statutoryReferences[]`, `authorityScope`, `minimumRoleToPublish`; import warnings for out-of-scope tenants.

**Building blocks:** FN-09 manifest extension. **Gap:** policy enforcement in import command.

**Acceptance:** Birth/Death pack import shows CRS Act warning; requires Admin ack cross-tenant.

---

#### FN-30 — Service API / Webhook Exposure
**Phase:** 3 · **Actor:** Platform Admin

**Flow:** opt-in REST webhook on application state changes for inter-agency integration (police verification callback).

**Building blocks:** `services/notification-service/src/modules/webhook/`, gateway routes. **Gap:** per-service subscription config.

**Acceptance:** staging webhook receives `issued` event payload.

---

#### FN-31 — Per-Service KPI Dashboard
**Phase:** 3 · **Actor:** Department Head

**Flow:** auto dashboard: volume, median processing time, fee collection rate, SLA compliance.

**Building blocks:** `services/citizen-service/src/modules/analytics/`, `services/report-service/src/modules/dashboard/`. **Gap:** pack-keyed dashboard template.

**Acceptance:** publish new pack → dashboard populates within 24h staging data.

---

#### FN-22 — Cross-Office Fee & Form Variants
**Phase:** 3 · **Actor:** Service Designer, Zonal Admin

**Flow:** offering office overrides: ward-specific fee slab, optional extra document, without forking pack.

**Building blocks:** extend pack with `officeOverrides[]`. **Gap:** override merge rules at runtime.

**Acceptance:** Zone A fee differs from Zone B; same pack version.

---

## 8. Domain Packs

### 8.1 Municipal / ULB (Phase 0 — first-class)

Grounded in UPYOG Java models (Appendix A). These six services are the **reference Domain Pack** `municipal-in-v1`.

#### 8.1.1 Trade License (Certificate/Permission) — **canonical pilot**
**Form fields:** tradeName, propertyId, applicationDate, licenseType (TEMPORARY/PERMANENT), tradeUnit(s) category/subcategory/UoM, owner details, documents.  
**Workflow:** Submit → Field Inspection (Licensing Inspector) → Approve/Reject (Licensing Officer) → Fee → Issue. Renewal annual, shortened form.  
**Fee:** flat per category or slab by unit count — FN-04.  
**Payment:** `businessService="TL"`, `consumerCode`= licence/application number.  
**Certificate:** `TL/{ward}/{year}/{seq}`, valid-from/to, QR verify.  
**Pack:** FN-01–FN-08 populated; walkthrough service for DoD.

#### 8.1.2 Water & Sewerage Connection (Permission + one-time fee)
**Form fields:** propertyId, connectionType/Category, roadType/roadCuttingInfo, proposedPipeSize, proposedTaps, plumberInfo[], connectionHolders[].  
**Workflow:** Submit → Document Verification → Field Inspection → Approve → Execution → Issue.  
**Fee:** connection fee Studio-configurable; **recurring metered billing out of scope v1**.  
**Payment:** `businessService="WS"`, one-time demand.  
**Verdict:** second pilot — field inspection + one-time fee.

#### 8.1.3 Public Grievance Redressal / PGR (Grievance)
**Form fields:** serviceCode (category), description, address, priority; post-resolution rating.  
**Workflow:** Submit → Auto-Assign (category+ward) → Resolve/Reject → Rating. No fee.  
**Output:** closure note (FN-07 non-certificate type).  
**Verdict:** retrofit `citizen-service/grievance` as first **wrap existing module** proof.

#### 8.1.4 Fire NOC (Certificate/Permission)
**Fields:** premises, occupancy type, building height/floors (risk category), applicant/owner.  
**Workflow:** Submit → Site Inspection (Fire Inspector) → Risk Assessment → Approve/Reject → Issue; mandatory renewal.  
**Fee:** slab by occupancy/risk — FN-04.  
**Verdict:** third pilot — same pattern as TL, different department.

#### 8.1.5 Property Tax Self-Assessment (Collection + Engine Binding)
**Form fields:** usage, noOfFloors, landArea, buildUpArea, units[], propertyType/SubType, assessmentNumber, usageCategory, ownershipCategory, owners[], adhocExemption/Penalty.  
**Workflow:** Submit → Assessment (engine) → optional Field Verification → Demand.  
**Fee:** **not Studio-pure** — bind to `revenue.assessment` engine; Studio edits exemptions, penalty/rebate %, windows, HOA only.  
**Payment:** `businessService="PT"`, multi-line `demandDetails` (general tax, education cess, penalty, rebate).  
**Verdict:** parameter-only in v1; assessment engine remains engineered.

#### 8.1.6 Birth & Death Registration (Certificate, statutory)
**Fields:** registrant, event date/place, informant, hospital/institution ref, registrar designation (verify UPYOG `birth-death-services` before build).  
**Workflow:** Submit → Registrar Verification → Register → Issue.  
**Fee:** flat; free within statutory window; late penalty slab.  
**Verdict:** mandatory statutory refs (FN-29); Platform Admin review policy for publish.

**Municipal Phase 0 pilot order:** Trade License → PGR retrofit → Water Connection → Fire NOC → PT parameters → Birth/Death parameters.

---

### 8.2 Revenue (State / ULB shared)

| Service | Pattern | Engine Binding | Studio scope v1 |
|---|---|---|---|
| Professional tax registration | Certificate | flat fee | full pack |
| Entertainment duty licence | Certificate | slab | full pack |
| GST adjudication fee payment | Collection | `revenue.billing` | fee + HOA |
| Demand notice objection | Grievance | — | workflow + docs |
| Amnesty scheme enrollment | Collection | `revenue.rate-engine` rebates | parameters + schedule |

Reuse: `revenue-service/modules/{rate-engine,assessment,billing,collection,bbps,arrears}/`.

---

### 8.3 Police

| Service | Pattern | Engine Binding | Studio scope v1 |
|---|---|---|---|
| Character certificate | Certificate | verification API (external) | form + workflow + fee; binding required |
| Event permission | Permission | — | full pack |
| Tenant verification | Permission | police tenant DB | form + workflow; verification binding |
| Lost article report | Grievance | — | full pack |

Honesty: police record verification is **engineered**; Designer composes intake and workflow only.

---

### 8.4 Health

| Service | Pattern | Engine Binding | Studio scope v1 |
|---|---|---|---|
| Drug licence renewal | Certificate | inspection scheduling | full pack + `inspection-service` binding |
| Birth registration (state hospital) | Certificate | CRS engine | parameters only (same as municipal BD) |
| Health trade licence | Certificate | — | full pack |
| Food safety inspection request | Grievance | `inspection-service/planning` | case workflow |

Reuse: `inspection-service/modules/{planning,assignment,licence,evidence}/`.

---

### 8.5 Education

| Service | Pattern | Engine Binding | Studio scope v1 |
|---|---|---|---|
| School admission (general seat) | Certificate/Booking | seat allocation engine | form + workflow; allocation binding |
| Transfer certificate request | Certificate | — | full pack |
| Scholarship application | Collection/Grievance hybrid | means-test engine | parameters |
| RTE grievance | Grievance | — | full pack |

Honesty: seat allocation and means-test are **engines**; not Studio-built logic v1.

---

### 8.6 General Administration

| Service | Pattern | Engine Binding | Studio scope v1 |
|---|---|---|---|
| Hall / vehicle booking | Booking | — | full pack |
| RTI application | Grievance | `citizen-service/rti` | wrap existing |
| NOC for construction (simple) | Permission | plan scrutiny engine | parameters only |
| Income certificate | Certificate | income verification | workflow + template; verification binding |

Reuse: `citizen-service/modules/rti/`, `meeting-service` (if booking rooms), `estab-service` (internal parallels).

---

## 9. ERP Reuse Map (verified paths)

| Designer concern | Reuse (existing path) | Extends | Net-new |
|---|---|---|---|
| **Catalogue** | `services/citizen-service/src/modules/catalogue/{schema,routes,commands,repo,domain}.ts` | `servicePattern`, `ownerOfficeId`, version pin | Authoring UI: `apps/web/src/app/(app)/citizen/catalogue/page.tsx` |
| **Application runtime** | `services/citizen-service/src/modules/application/{schema,routes,intake,intake-domain}.ts` | `formData`, `parentApplicationId`, version pin | Pack-driven UI |
| **Metadata / forms** | `services/metadata-service/src/modules/{entities,fields,forms,layouts,composition,preview}/` | service-scoped form refs | Visual builder replacing `apps/web/src/app/(app)/metadata/forms/page.tsx` |
| **Formula eval** | `services/metadata-service/src/modules/formula/domain.ts` | — | — |
| **Numbering** | `services/metadata-service/src/modules/numbering/{schema,routes,domain}.ts` | pack-bound formats | Numbering UI in B7 |
| **Eligibility** | `services/citizen-service/src/modules/eligibility/{domain,routes,commands}.ts` | — | Rule builder UI |
| **Fee (flat)** | `services/citizen-service/src/modules/fee-payment/{schema,routes,commands,repo}.ts` | HOA mapping column | Service-linked fee UI |
| **Fee (slab)** | `services/revenue-service/src/modules/rate-engine/{schema,routes,domain,commands}.ts` | service ref | Extend `apps/web/src/app/(app)/revenue/config/RateConfigConsole.tsx` |
| **Assessment engine** | `services/revenue-service/src/modules/assessment/{schema,domain,commands}.ts` | Engine Binding config | Parameter UI only |
| **HOA** | `services/finance-service/src/modules/hoa/{schema,routes,repo,domain}.ts` | pack default HOA | Dropdown in FN-04 |
| **Workflow** | `services/workflow-service/src/modules/{designer,definitions,bpmn,dmn,sla,workbaskets,instances,tasks}/` | pattern templates | Template layer on `apps/web/.../workflow/designer/` |
| **Documents** | `services/citizen-service/src/modules/documents/` + `catalogue.schema.requiredDocuments` | — | Checklist UI |
| **Issuance** | `services/citizen-service/src/modules/issuance/{schema,routes,domain,repo}.ts` | closure note type | Template authoring UI |
| **Grievance** | `services/citizen-service/src/modules/grievance/{schema,routes,consumer}.ts` | pack wrapper | PGR retrofit |
| **Discovery** | `services/citizen-service/src/modules/discovery/` | pack-aware search | — |
| **Notifications** | `services/notification-service/src/modules/templates/{schema,commands,routes}.ts`, `modules/channels/` | per-service event bindings | join table + UI |
| **Tenant / org** | `services/tenant-service/src/modules/org-hierarchy/`, `modules/positions/`, `modules/tenant/onboard.ts` | Owning Office FK | scoped catalogue |
| **Location** | `services/location-service/src/modules/hierarchy/`, `modules/jurisdiction/`, `modules/locations/` | ward picker widgets | form field adapters |
| **Billing / pay** | `services/billing-service/src/modules/payments/`, `modules/gateways/` | demand shape adapter | — |
| **BBPS** | `services/revenue-service/src/modules/bbps/{schema,routes,commands}.ts` | — | — |
| **GL posting** | `services/finance-service/src/modules/gl/{schema,commands,consumer,routes}.ts` | payment event consumer | **critical net-new consumer** |
| **Reports** | `services/report-service/src/modules/templates/`, `modules/jobs/` | pattern-keyed templates | auto-attach |
| **Install / onboarding** | `services/install-service/src/modules/{orchestrator,provisioning,stages}/` | activate Domain Pack step | wizard UI |
| **Audit** | `services/audit-service/` (platform) | publish/fee audit events | Auditor views |
| **Pack registry** | — | — | `citizen-service/modules/packs/` full module |
| **Designer shell** | — | — | `apps/web/src/app/(app)/designer/` (proposed) |

---

## 10. Proposed Data Model (net-new / extensions)

```text
catalogue.service_definitions (extend)
  + service_pattern           varchar(32)   -- certificate|booking|collection|grievance
  + owner_office_id           uuid FK -> tenant org-hierarchy
  + offering_office_ids       uuid[]
  + workflow_definition_id    uuid
  + form_id                   uuid FK -> metadata forms
  + fee_model                 varchar(8)    -- flat|slab|engine
  + hoa_code                  varchar(32)
  + statutory_references      jsonb

packs.service_packs (new schema in citizen-service)
  id, tenant_id, source_tenant_id, pack_key, domain_pack_key, name, service_pattern
  service_definition_id, form_id, eligibility_rule_set_id, fee_model, fee_ref_id
  workflow_definition_id, certificate_template_id, numbering_format_id
  engine_bindings             jsonb
  statutory_references        jsonb
  hoa_code, manifest          jsonb
  status, version, created_by, published_by, timestamps, row_version

packs.domain_packs (new)
  id, domain_pack_key, sector, jurisdiction, version, manifest, packs[]

application.citizen_applications (extend)
  + service_definition_version integer
  + parent_application_id      uuid nullable
  + form_data                  jsonb
  + applicant_type             varchar(16)
  + workflow_instance_id       uuid

packs.studio_test_runs (new)
  id, pack_id, pack_version, result, step_results jsonb, artifacts jsonb, run_at, run_by

notification.service_event_templates (new join)
  tenant_id, service_definition_id, event_key, template_id, channels jsonb
```

Verify `application` schema before migration — partial fields may exist under different names.

---

## 11. Roadmap (Phases 0–3)

### Phase 0 — Foundation + Municipal Domain Pack (pre-GA gate)
**Goal:** fix platform wiring so fee-bearing services are financially honest; ship `municipal-in-v1` Domain Pack spec + seed manifests.

| Item | FNs | Exit criterion |
|---|---|---|
| Revenue → GL consumer | FN-14 | Sandbox payment posts balanced journal |
| Tenant context on new consumers | all | no cross-tenant leakage in pack import/GL workers |
| Domain Pack registry schema + municipal manifest | FN-20 | TL + PGR + Water manifests importable as drafts |
| UAT wiring defects (empty pages, 400s) | — | catalogue/eligibility/fee paths return real data |
| Property Tax / Birth-Death **parameter** schemas documented | FN-21 | Engine Binding stubs with honest "engine required" errors |

**Duration guidance:** 4–6 weeks engineering after priority order set.

---

### Phase 1 — Universal Designer Core (authoring)
**Goal:** Service Designer can author B1–B7 for Certificate pattern without code.

| Item | FNs |
|---|---|
| Catalogue authoring UI + Service Pattern | FN-01, FN-19 |
| Owning Office FK + scoping | FN-12 |
| Form builder (metadata visual UI) | FN-02 |
| Eligibility, documents, fee, certificate UIs | FN-03, FN-04, FN-06, FN-07 |
| Workflow pattern-template layer | FN-05 |
| Maker-checker hardening | FN-11 |

**Exit:** Trade License pack authored and submitted (Test optional this phase).

---

### Phase 2 — Runtime, Packs, Test, Onboarding
**Goal:** end-to-end citizen journey + pack portability.

| Item | FNs |
|---|---|
| Pack export/import + library | FN-09 |
| Sandbox Test orchestration | FN-10 |
| Pack-driven application runtime | FN-13 |
| Designer 8-block shell | FN-33 |
| Notifications binding | FN-08 |
| Onboarding Domain Pack activation | FN-17 |
| Statutory manifest on import | FN-29 |
| SLA/escalation + doc verification lanes | FN-25, FN-26 |
| Applicant types + channels | FN-23, FN-24 |
| Engine Binding UI | FN-21 |

**Exit:** DoD §13 (a)–(e) satisfied with Trade License + PGR or Water.

---

### Phase 3 — Cross-Sector Packs + Governance Depth
**Goal:** Revenue/Police/Health/Education/General Admin starter packs; renewal, localization, analytics.

| Item | FNs |
|---|---|
| Domain packs: revenue, police, health, education, general-admin | FN-20 extensions |
| Renewal/amendment/surrender | FN-15 |
| Localization | FN-18 |
| Reporting + KPI dashboards | FN-16, FN-31 |
| Appeal/grievance + RTI hooks | FN-27, FN-28 |
| Cross-office overrides | FN-22 |
| API/webhooks | FN-30 |
| Accessibility preview | FN-32 |

**Exit:** two non-municipal packs (e.g. character certificate + hall booking) published via same Designer.

---

## 12. Explicit Non-Goals & Engines (v1)

The Universal Service Designer **does not** build these as Studio-authorable logic. Each remains an **engine** optionally bound via FN-21:

| Engine | Reason | Studio role |
|---|---|---|
| Property tax assessment computation | State act formulas, unit-area matrices | Parameters: exemptions, penalty, HOA |
| Water/sewerage metered recurring billing | No metering engine in CivitasOne today | One-time connection fee only |
| Building plan automated scrutiny (eDCR) | CAD/rules engine | Simple NOC intake only |
| CRS-grade birth/death registrar of record | Statutory immutability requirements | Late fee + document checklist parameters |
| Police criminal record verification | External CCTNS/STATE systems | Intake + workflow + callback webhook |
| School seat allocation / lottery | Constrained optimization | Form + workflow; binding to allocation engine |
| Means-test / income verification | External department data | Template + workflow |
| DMN/BPMN replacement | Already in workflow-service | Use advanced path, don't duplicate |

**Scope creep guard:** if a service "needs custom application-runtime code," that signals insufficient primitives — extend the 8-block model or add Engine Binding, do not fork a hand-built page (`apps/web/.../citizen/*` per-service pages are legacy, not template).

---

## 13. Definition of Done — Universal Service Designer v1

v1 is **done** when all of the following are demonstrated in staging:

**(a)** Department Head builds, tests, and publishes a **Certificate-pattern** service end-to-end with zero engineering — verified live with **Trade License** (§8.1.1).

**(b)** A structurally different service (**PGR retrofit** §8.1.3 or **Water Connection** §8.1.2) is built the same way — proves generalization beyond one pilot.

**(c)** Every published fee-bearing pack posts to **GL on payment** (FN-14) — hard gate.

**(d)** Pack exported from Department A is imported and republished by Department B or another tenant (FN-09) — local governance preserved (draft, not auto-publish).

**(e)** Sandbox Test (FN-10) catches wiring defects equivalent to 2026-08-05 UAT class on a deliberately broken pack.

**(f)** **`municipal-in-v1` Domain Pack** activates via onboarding (FN-17) producing ≥3 editable drafts (TL, PGR, Water).

**(g)** At least one **non-municipal** pack (hall booking or RTI) is authored using the same 8-block wizard — proves universality label.

---

## 14. Non-Functional Requirements

- **Multi-tenancy:** every Studio entity carries `tenantId`; RLS on all new tables; pack import/export workers set tenant GUC — do not repeat hrms/estab consumer tenant gaps from UAT.
- **Security / audit:** every publish, fee, workflow change audit-logged via `audit-service` with before/after.
- **Performance:** form/eligibility/fee evaluation <500ms server-side per citizen step; cache via `@civitasone/cache` on read paths per `CLAUDE.md`.
- **CQRS:** Studio authoring routes enqueue mutations; consumers apply writes — no direct Drizzle writes in route handlers for pack/application entities.
- **Accessibility:** FN-13 runtime WCAG 2.1 AA; FN-32 preview in Designer.
- **Offline (stretch):** extend service worker draft save (`application/application_drafts`) — not v1-blocking.

---

## 15. Open Questions

| # | Question | Owner | Blocks |
|---|---|---|---|
| OQ-1 | Localization: build new `i18n-service`, extend `notification-service/i18n`, or tenant-scoped jsonb on metadata forms? | Architecture | FN-18 estimate |
| OQ-2 | Birth/Death & Fire NOC: field-level UPYOG verification before Phase 2 build? | Domain | §8.1.4, §8.1.6 |
| OQ-3 | Platform Admin vs statutory registrar role for Birth/Death publish inside tenant? | Policy | FN-29 |
| OQ-4 | Company applicant profile: `crm-service` vs new `citizen-service/registry` extension? | Architecture | FN-23 |
| OQ-5 | Demand generation owner: `billing-service/revenue` vs `revenue-service/billing` for Studio demands? | Engineering | FN-14 |
| OQ-6 | Pack module home: `citizen-service/packs` vs new lightweight `studio-service`? | Architecture | FN-09 |
| OQ-7 | Cross-tenant pack signing: manifest checksum + publisher org cert for supply-chain trust? | Security | FN-09, FN-20 |
| OQ-8 | Property Tax engine timeline: bind to partial `revenue-service/assessment` or wait for dedicated module? | Product | §8.1.5 Phase 0 honesty |
| OQ-9 | Designer shell route: `/designer` vs extend `/citizen/catalogue` admin tab? | UX | FN-33 |
| OQ-10 | GL posting consumer: synchronous in payment webhook vs async queue consumer? | Finance arch | FN-14 |

---

## Appendix A — UPYOG Source Files (Municipal Grounding)

- Trade License: `municipal-services/tl-services/.../TradeLicense.java`, `TradeLicenseDetail.java`
- Property Tax: `municipal-services/pt-services-v2/.../Property.java`, `PropertyDetail.java`
- Water: `municipal-services/ws-services/.../Connection.java`, `WaterConnection.java`
- PGR: `municipal-services/pgr-services/.../Service.java`, `ServiceRequest.java`
- Demand: `business-services/billing-service/.../Demand.java`, `Bill.java`
- Fire NOC / Birth-Death: module presence verified; **field-level verification required before Phase 2 build** (OQ-2)

## Appendix B — CivitasOne Source Files (2026-08-07)

Primary verification paths listed in §9. Web surfaces: `apps/web/src/app/(app)/citizen/`, `apps/web/src/app/(app)/metadata/`, `apps/web/src/app/(app)/workflow/designer/`, `apps/web/src/app/(app)/revenue/config/`.

## Appendix C — Document Lineage

| Document | Relationship |
|---|---|
| `CIVITASONE-SERVICE-STUDIO-BRD-2026-08-07.md` | Direct predecessor — municipal Service Studio scope |
| `docs/FINAL-UAT-GAP-REPORT.md` | GL posting gap, wiring defects |
| `CLAUDE.md` / `docs/ARCHITECTURE.md` | CQRS, tenant isolation, module boundaries |

---

*Generated 2026-08-07. CivitasOne Universal Service Designer BRD — universal 8-block composition with Municipal/ULB as first-class Phase 0 Domain Pack.*
