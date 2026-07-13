# D09 — Collectorate Capability Gap Assessment

**Lane:** L03 · **Date:** 2026-07-13  
**Reviewer role:** District Collector/DM Process Expert + Revenue Administration Expert  
**Source branch:** `court-management-service` · repo at `/tmp/cms-wt`

> **PREREQUISITE BLOCKER (read first):** The org model today is `Tenant → Department → User` with no office, position, posting, or jurisdiction. [VERIFIED: `d05-admin-organogram.md §2`, `d23b-identity-config-assessment.md §2.1`, `packages/types/src/index.ts:71` — `RequestContext` has no `officeId`/`positionId`/`jurisdictionId`]. No collectorate office can be represented as a distinct entity today. This is a **P0 blocker for all office-scoped capabilities** in this file. See §9 for DDL.

---

## 1. Summary Scorecard

| # | Capability | Mapped Service | Verdict | Priority |
|---|---|---|---|---|
| 1 | General administration (file movement, noting, DFA) | estab-service | **Fully-available** | — |
| 2 | Establishment / cadre management | estab-service | **Fully-available** | — |
| 3 | HRMS (employee lifecycle) | hrms-service | **Requires-extension** | P1 |
| 4 | Payroll | payroll-service | **Fully-available** | — |
| 5 | Finance / accounts | finance-service | **Requires-extension** | P1 |
| 6 | Budget | finance-service | **Fully-available** | — |
| 7 | Procurement (GFR) | procurement-service | **Fully-available** | — |
| 8 | Inventory / stores | inventory-service + stock-service | **Fully-available** | — |
| 9 | Assets | asset-service | **Fully-available** | — |
| 10 | Contracts | contract-service | **Fully-available** | — |
| 11 | eOffice / file movement | estab-service | **Fully-available** | — |
| 12 | Meetings / committee | meeting-service | **Fully-available** | — |
| 13 | Workflow engine | workflow-service | **Fully-available** | — |
| 14 | Legal / litigation tracking | legal-service | **Configurable (needs config)** | P1 |
| 15 | Revenue court (DC/Collector Court) | court-service | **Configurable (needs config)** | P1 |
| 16 | Public grievance / RTI | citizen-service | **Requires-extension** | P0 |
| 17 | Citizen services / certificates | citizen-service | **Requires-extension** | P1 |
| 18 | Land acquisition | — | **Requires-new-module** | P1 |
| 19 | Disaster management / SDRF | — | **Requires-new-module** | P0 |
| 20 | Election coordination | — | **Requires-new-module** | P1 |
| 21 | Licensing (arms, liquor, trade, explosive) | — | **Requires-new-module** | P1 |
| 22 | Relief and compensation distribution | — | **Requires-new-module** | P1 |
| 23 | Inspection (departmental / field) | — | **Requires-new-module** | P2 |
| 24 | Scheme monitoring | grant-service + project-service | **Configurable (needs config)** | P1 |
| 25 | District dashboard | analytics-service + report-service | **Requires-extension** | P1 |

---

## 2. Capability-by-Capability Detail

### 2.1 General Administration / eOffice File Movement
**Verdict: Fully-available [VERIFIED]**

`estab-service` has a complete eOffice implementation:
- `services/estab-service/src/modules/files/schema.ts` — `files.estab_files`: fileNo, subject, dept, departmentId, priority, classification (`top_secret/secret/confidential/public`), currentWith (UUID FK to officer), status, VIP reference, Parliament Q-no, fileType (CSMOP taxonomy: `main/part/volume/linked/standing_guard/ephemeral`), volumeNo, partNo, linkedFileIds
- `services/estab-service/src/modules/files/schema.ts` — `files.estab_notings`: sequential noting with officerDesignation, note_type (`yellow/green/remark/order`), DSC hash, eSigned flag
- `services/estab-service/src/modules/files/schema.ts` — `files.estab_dispatch`: dispatch register with delivery tracking
- DFA (Draft for Approval): `modules/dfa/schema.ts` — templates, versioned drafts, approval/return workflow
- `modules/approval-rules/schema.ts` — amount-tiered DFA routing to workflow definitions
- `modules/files/domain.ts` — CSMOP file-number derivation: `deriveChildFileNo()`, Roman-numeral volume numbering

**Note:** The `departmentId` field exists but no `officeId` — routing is department-scoped, not office-scoped. For a Collectorate, the same department (Revenue) has multiple offices (DC's office, SDM offices). Office-scoping requires the org model fix (§9).

---

### 2.2 Establishment / Cadre Management
**Verdict: Fully-available [VERIFIED]**

`estab-service/src/modules/`: records (service books), handover, migration (inter-department), referencing (seniority), operators (staffing eligibility). All CQRS modules with full schemas.

---

### 2.3 HRMS (employee lifecycle)
**Verdict: Requires-extension [VERIFIED] — Priority P1**

`hrms-service` has designations, departments, transfers, pension, GPF, leave, attendance. [VERIFIED: memory ref `project_hrms_payroll_built.md`]

**Gap for Collectorate:** `hrms_transfers` has no `positionId`, no acting/additional-charge flag, no jurisdictionId [VERIFIED: `d05-admin-organogram.md §3`]. Transfer orders at Collectorate level typically involve position-to-position movement across hierarchical offices. Without office/position/posting model, transfers cannot be jurisdiction-scoped.

**Required extension:**
```sql
-- hrms-service: add to employee.hrms_transfers
ALTER TABLE employee.hrms_transfers
  ADD COLUMN office_id        UUID,          -- FK → hierarchy.offices (P0 dependency)
  ADD COLUMN position_id      UUID,          -- FK → hierarchy.positions
  ADD COLUMN is_acting_charge BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN is_additional    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN jur_unit_ids     UUID[];        -- jurisdictions held
```

---

### 2.4 Payroll
**Verdict: Fully-available [VERIFIED]**

`payroll-service` covers GPF, NPS, tax, allowances, payslip. [VERIFIED: memory ref `project_hrms_payroll_built.md`, 15/15 tests pass]

---

### 2.5 Finance / Accounts
**Verdict: Requires-extension [VERIFIED] — Priority P1**

`finance-service` has budget (demands, re-appropriations, sanctions), GL, treasury (challans, deposits, guarantees), payments. PFMS HoA/DDO validators at `services/finance-service/src/shared/pfms.ts:10-47`. [VERIFIED]

**Gap:** No integration with State IFMS/Treasury portal. `finance-service/src/modules/org-structure/schema.ts:32` has `treasury_code` column but no outbound treasury API adapter. For a Collectorate, the DC acts as the controlling authority; budget against state treasury needs live IFMS read-through.

**Required extension:** Add `packages/gov-adapters/src/ifms-adapter.ts` (state-specific; adapter pattern so each state's IFMS URL is config-driven).

---

### 2.6 Budget
**Verdict: Fully-available [VERIFIED]**

`finance-service/src/modules/budget/schema.ts` — `finance_demands` (demand number, FY, amount), `finance_budgets` (BE/RE/actuals), `finance_reappropriations` (GFR Rule 10 zero-sum). Re-appropriation routed via eOffice approval. [VERIFIED]

---

### 2.7 Procurement
**Verdict: Fully-available [VERIFIED]**

`procurement-service` with GFR-mode bands. [VERIFIED: memory ref `project_procurement_contract_built.md`, 14/14 tests pass]

---

### 2.8 Inventory / Stores
**Verdict: Fully-available [VERIFIED]**

`inventory-service` + `stock-service`, 5 L2 modules each. [VERIFIED: memory ref `project_asset_stock_services_built.md`]

---

### 2.9 Assets
**Verdict: Fully-available [VERIFIED]**

`asset-service`, 5 L2 modules, 11 tables. [VERIFIED: memory ref `project_asset_stock_services_built.md`]

---

### 2.10 Contracts
**Verdict: Fully-available [VERIFIED]**

`contract-service`, 2 L2 modules, 5 tables. [VERIFIED: memory ref `project_procurement_contract_built.md`]

---

### 2.11 eOffice / File Movement
Covered in §2.1.

---

### 2.12 Meetings / Committees
**Verdict: Fully-available [VERIFIED]**

`meeting-service` has agenda, minutes, voting, action items, VC integration. [VERIFIED: memory ref `project_knowledge_workflow_analytics_built.md`, 9/9 tests]

---

### 2.13 Workflow Engine
**Verdict: Fully-available [VERIFIED]**

`workflow-service` has BPMN-based definitions, node-level SLA, delegation, DMN decision tables, sub-workflows (callDefinitionCode), assignment strategies (round-robin/least-loaded/hierarchy). [VERIFIED: `services/workflow-service/src/modules/definitions/schema.ts`]

---

### 2.14 Legal / Litigation Tracking
**Verdict: Configurable (needs config) [VERIFIED] — Priority P1**

`legal-service` has: cases, hearings, filings, documents, counsel, notices, opinions, settlements, limitations, eCourts adapter. [VERIFIED: file listing above]. Covers High Court/Supreme Court cases filed against the district.

`services/legal-service/src/modules/ecourts/adapter.ts:1-14` — eCourts/NJDG adapter with circuit-breaker, env-gated (`ECOURTS_ENABLED`). Provides CNR-based case status lookup.

**What is needed:**
1. Enable `ECOURTS_ENABLED=true` and configure `ECOURTS_BASE_URL` (NJDG API endpoint)
2. Map collector-specific notice templates for court notices involving GoI/State vs citizens
3. SLA calendar for limitation periods (State-specific; config key `legal.limitation_calendar`)

**Not needed:** Judicial case management — eCourts is system-of-record; legal-service reads/syncs, does NOT replace it.

---

### 2.15 Revenue Court (Collector Court / DC Court)
**Verdict: Configurable (needs config) [VERIFIED] — Priority P1**

`court-service` has 22 live tables in `civitas_court` DB [VERIFIED: `\dt court.*`]:
- `courts`, `benches`, `cases`, `case_parties` (AES-256-GCM PII), `case_state_transitions`, `cause_lists`, `cause_list_items`, `hearings`, `orders`, `filings`, `case_scrutiny`, `case_defect`, `evidence`, `notices`, `notice_service`, `compliance_directions`, `appeals`, `certified_copies`, `case_parcels`, `config_entries`, `otp_challenges`, `public_establishments`

`services/court-service/src/modules/config-registry/presets.ts` — `VERTICAL_PRESETS.revenue` [VERIFIED]:
```typescript
{ namespace: "court_type", configKey: "tehsildar",     label: "Tehsildar Court" },
{ namespace: "court_type", configKey: "sdm_court",     label: "Sub-Divisional Magistrate Court" },
{ namespace: "court_type", configKey: "collector_court", label: "Collector Court" },
{ namespace: "court_type", configKey: "revenue_court", label: "Revenue Court" },
{ namespace: "case_type",  configKey: "mutation",       label: "Mutation" },
{ namespace: "case_type",  configKey: "partition",      label: "Partition" },
{ namespace: "case_type",  configKey: "revenue_appeal", label: "Revenue Appeal" },
{ namespace: "case_type",  configKey: "land_acquisition", label: "Land Acquisition" },
{ namespace: "case_type",  configKey: "tenancy",        label: "Tenancy" },
```

`services/court-service/src/modules/case-parcel/schema.ts` — `court.case_parcels` with `survey_number`, `khasra_number`, `khata_number`, `village`, `tehsil`, `district`, `area_sqm` (bigint metres) [VERIFIED].

**What is needed to activate for Collectorate:**
```bash
POST /v1/court/config/presets/apply { "preset": "revenue" }   # idempotent
POST /v1/court/courts { "name":"Collector Court, Dist X", "courtType":"collector_court", ... }
```

**Gap:** `case_parcels.tehsil` and `.district` are free-text columns, not FK to `hierarchy.administrative_units`. When land records integration is added, these must become unit_id references.

---

### 2.16 Public Grievance / RTI
**Verdict: Requires-extension [VERIFIED] — Priority P0**

`citizen-service` has:
- `modules/grievance/` — full CQRS, state machine (`registered→assigned→in_progress→resolved→closed→reopened`), auto-priority by category, 7-day SLA escalation [VERIFIED: `modules/grievance/domain.ts`]
- `modules/rti/` — RTI Act 2005, RTI deadline tracking [VERIFIED: file listing]
- `modules/helpdesk/domain.ts:1-2` — CPGRAMS stub: `export const CPGRAMS_API_STUB = "https://cpgrams.gov.in/api/v1";` — **no implementation**

**P0 gaps:**
1. **CPGRAMS integration is a stub.** For Collectorate, CPGRAMS/PGPORTAL is mandatory (grievances from national/state portals land via CPGRAMS API). Must implement `packages/gov-adapters/src/cpgrams-adapter.ts`:
   ```typescript
   // [PROPOSED]
   export interface CpgramsAdapter {
     fetchPending(districtCode: string): Promise<CpgramsGrievance[]>;
     updateStatus(pgId: string, status: string, remarks: string): Promise<void>;
   }
   ```
2. **No district-code / office-code on grievances.** Routing to DC office requires `grievance.assigned_office_id` and `grievance.jurisdiction_unit_id` columns.
3. **No hierarchy-based escalation.** SDM → DC escalation path is hardcoded logic; needs to consult office hierarchy (P0 org model dependency).

---

### 2.17 Citizen Services / Certificates
**Verdict: Requires-extension [VERIFIED] — Priority P1**

`citizen-service/src/modules/application/schema.ts` — `application.citizen_applications`: citizenId, serviceId (UUID ref), refNo, status, deadline [VERIFIED].

**Gap:** `serviceId` references a service catalog that does not exist as a distinct entity. There is no `service_catalog` table defining certificate types, eligibility rules, required documents, or designated authority. For a Collectorate:
- Income certificate — Tehsildar/SDM designated
- Caste certificate — designated authority varies by state
- Domicile certificate — SDM/DC designated
- OBC/SC/ST certificates — statutory form-specific

**Required:**
```sql
-- citizen-service, new module: service-catalog
CREATE TABLE application.service_catalog (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  service_code   VARCHAR(64) NOT NULL,
  name           TEXT NOT NULL,
  designated_position_code VARCHAR(64),  -- links to hierarchy.positions
  sla_days       INTEGER NOT NULL,
  form_schema    JSONB,
  required_docs  JSONB,
  fee_minor      BIGINT DEFAULT 0,
  active         BOOLEAN DEFAULT true,
  ...
);
```

DigiLocker token field exists in `portal.schema.ts:21` (encrypted); DigiLocker provider stub at `portal/domain.ts:2`. No actual DigiLocker pull-documents API call implemented.

---

### 2.18 Land Acquisition
**Verdict: Requires-new-module [VERIFIED ABSENT] — Priority P1**

No service, table, route, or schema references LA Award, Section 4/6/9/11 LARR Act 2013, compensation computation, or social impact assessment. `case_parcels` in court-service is for disputed parcels in court cases, not for LA proceedings.

**Required new module in court-service or a standalone service:**

```sql
-- [PROPOSED] land-acquisition-service (or module in district-service)
CREATE TABLE la.proceedings (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  notification_no TEXT NOT NULL,       -- Section 11 notification number
  acquisition_no  TEXT NOT NULL,
  purpose         TEXT NOT NULL,
  la_act          VARCHAR(32) NOT NULL DEFAULT 'LARR_2013',
  status          VARCHAR(32) NOT NULL DEFAULT 'section_4',  -- state machine
  district_unit_id UUID NOT NULL,      -- FK → hierarchy.administrative_units
  total_area_sqm  BIGINT,
  award_date      DATE,
  award_ref       TEXT,
  ...standard cols...
);

CREATE TABLE la.parcels (
  id             UUID PRIMARY KEY,
  proceeding_id  UUID NOT NULL,
  survey_no      VARCHAR(64) NOT NULL,
  khasra_no      VARCHAR(64),
  village        VARCHAR(120) NOT NULL,
  area_sqm       BIGINT,
  owner_ref      TEXT,                 -- opaque ref to state land records
  compensation_minor BIGINT,           -- paise
  status         VARCHAR(32) NOT NULL DEFAULT 'notified',
  payment_ref    TEXT,
  ...standard cols...
);

CREATE TABLE la.objections (
  id             UUID PRIMARY KEY,
  proceeding_id  UUID NOT NULL,
  objector_name  TEXT NOT NULL,
  filed_at       TIMESTAMP WITH TIME ZONE,
  hearing_date   DATE,
  decision       TEXT,
  ...standard cols...
);
```

**Integration note:** State land records (Bhoomi/Bhunaksha/DILRMP) are system-of-record for khasra/khata. LA module stores opaque `owner_ref` (not copies) and integrates via read-only adapter.

---

### 2.19 Disaster Management / SDRF
**Verdict: Requires-new-module [VERIFIED ABSENT] — Priority P0**

No grep match for `disaster`, `relief`, `SDRF`, `NDRF`, `calamity`, `flood`, `drought` in any service source. No service exists.

For a district pilot, DC is the Incident Commander. This is a **P0 gap** because disaster relief is a statutory function that operates on tight timelines and cross-department coordination.

**Required new `disaster-service`:**

```sql
CREATE TABLE disaster.incidents (
  id               UUID PRIMARY KEY,
  tenant_id        UUID NOT NULL,
  incident_type    VARCHAR(64) NOT NULL,  -- flood, drought, fire, earthquake, cyclone
  severity         VARCHAR(16) NOT NULL,  -- L1, L2, L3 (national)
  district_unit_id UUID NOT NULL,
  declared_at      TIMESTAMP WITH TIME ZONE,
  declared_by      UUID NOT NULL,         -- officer_id
  status           VARCHAR(32) NOT NULL DEFAULT 'active',
  ...standard cols...
);

CREATE TABLE disaster.relief_camps (
  id            UUID PRIMARY KEY,
  incident_id   UUID NOT NULL,
  name          TEXT NOT NULL,
  location_ref  TEXT,
  capacity      INTEGER,
  occupied      INTEGER NOT NULL DEFAULT 0,
  status        VARCHAR(24) NOT NULL DEFAULT 'active',
  ...standard cols...
);

CREATE TABLE disaster.affected_households (
  id            UUID PRIMARY KEY,
  incident_id   UUID NOT NULL,
  household_ref TEXT NOT NULL,     -- opaque ref; NOT a copy of citizen data
  village       VARCHAR(120),
  damage_type   VARCHAR(64),
  assessed_loss_minor BIGINT,
  compensation_minor  BIGINT,
  payment_status VARCHAR(32) DEFAULT 'pending',
  payment_ref   TEXT,
  ...standard cols...
);
```

Events: `disaster.incident.declared`, `disaster.relief.disbursed` → audit-service, analytics-service.

---

### 2.20 Election Coordination
**Verdict: Requires-new-module [VERIFIED ABSENT] — Priority P1**

No election-related code found in any service (grep: `election|electoral|voter|booth|ECI|MCC|BLO|DEO` — no hits in service source).

ECI/SVEEP functions, booth-level officer mapping, model code of conduct tracking, section-144 orders during elections — all absent.

**Note:** ECI's ERONET/NVSP is the system-of-record for voter rolls. CivitasOne must NOT duplicate voter data. Required capability: workflow for `section-144 orders`, `election duty posting`, `micro-observer deployment`, `expenditure monitoring`. These are workflows in workflow-service + an election-coordination module that stores internal administrative metadata only.

**Minimum required for district pilot:**
```
workflow-service: add election_duty_posting workflow definition
estab-service: reuse for election duty posting orders (transfers variant)
citizen-service: public interface for booth location lookup (read-only, from ECI API)
```

No new DB tables needed for P1; use workflow-service + estab-service + a lightweight election-config module.

---

### 2.21 Licensing (Arms, Liquor, Trade, Explosive, Petroleum)
**Verdict: Requires-new-module [VERIFIED ABSENT] — Priority P1**

No licensing capability exists (grep: `licence|license|permit|arms|firearm|liquor|trade licen` — hits only in unrelated visitor-service and court-service context).

Licensing under Arms Act 1959, Explosives Act 1884, state excise, trade license are core DC/SDM/Tehsildar functions.

**Required new `licensing-service`:**

```sql
CREATE TABLE lic.license_types (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  type_code     VARCHAR(64) NOT NULL,   -- arms_license_a, arms_license_b, liquor_retail, etc.
  act_ref       TEXT,                   -- "Arms Act 1959 s.3"
  authority_position_code VARCHAR(64),  -- Tehsildar / SDM / DC
  validity_years INTEGER,
  fee_minor     BIGINT,
  renewal_notice_days INTEGER DEFAULT 30,
  ...standard cols...
);

CREATE TABLE lic.licenses (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  license_type_id UUID NOT NULL,
  license_no      TEXT NOT NULL,
  issued_to_ref   TEXT NOT NULL,       -- citizen ref (opaque)
  issued_by       UUID NOT NULL,       -- officer_id
  office_id       UUID NOT NULL,       -- issuing office
  issued_at       TIMESTAMP WITH TIME ZONE,
  valid_from      DATE,
  valid_to        DATE,
  status          VARCHAR(32) NOT NULL DEFAULT 'active',  -- active/suspended/cancelled/expired
  conditions      JSONB,
  ...standard cols...
);

CREATE TABLE lic.verification_requests (
  id            UUID PRIMARY KEY,
  license_id    UUID NOT NULL,
  requested_by  UUID NOT NULL,        -- police/other agency officer
  purpose       TEXT,
  responded_at  TIMESTAMP WITH TIME ZONE,
  response_code VARCHAR(32),
  ...standard cols...
);
```

---

### 2.22 Relief and Compensation Distribution
**Verdict: Requires-new-module [VERIFIED ABSENT] — Priority P1**

Relief/compensation distribution (ex-gratia, SDRF payments) is a sub-function of disaster management (§2.19). Covered by `disaster.affected_households` table above. Also connects to PFMS (finance-service has PFMS validators but no disbursement-to-beneficiary flow for relief).

---

### 2.23 Inspection (Departmental / Field)
**Verdict: Requires-new-module [VERIFIED ABSENT] — Priority P2**

No inspection module (departmental inspection reports, surprise inspection orders, compliance tracking for subordinate offices). Not blocking a district pilot but required before district rollout.

**Minimum:** An `inspection` module in `workflow-service` as a workflow template + an `inspection-report` entity in a new L2 module (can live in `admin-service` or `estab-service`).

---

### 2.24 Scheme Monitoring
**Verdict: Configurable (needs config) [VERIFIED] — Priority P1**

`grant-service` (16 tables, UC statements, compliance, PFMS records, Aadhaar-masked beneficiary) + `project-service` (14 tables, physical/financial progress, geo-tags, DPR) are real. [VERIFIED: memory ref, schemas above]

**What is needed:**
1. Configure `grant_schemes` table with district-level scheme definitions (MNREGS, PM-AWAS, Jal Jeevan Mission, etc.)
2. Link `project_projects.district_unit_id` (currently a free-text `location` field) to `hierarchy.administrative_units` — **P0 org model dependency**
3. Configure analytics-service dashboards for scheme KPIs per district

---

### 2.25 District Dashboard
**Verdict: Requires-extension [VERIFIED] — Priority P1**

`analytics-service` has dashboards module with CQRS [VERIFIED: `modules/dashboards/schema.ts`]. `report-service` has KPIs, MIS, scheduled reports. [VERIFIED: file listing]

**Gap:** No district-specific KPI definitions exist. Dashboard schema is generic (configurable per tenant). No cross-service fact aggregation for district-level metrics (pending court cases + unresolved grievances + scheme utilisation + pending LA cases) — analytics-service `modules/facts/` consumes events but no `district_summary` fact table.

**Required extension:** Add a `district_dashboard` preset in analytics-service:
```typescript
// [PROPOSED] analytics-service/src/modules/registry/presets/district.ts
export const DISTRICT_DASHBOARD_KPIS = [
  "pending_revenue_court_cases", "grievances_breached_sla", "scheme_utilisation_pct",
  "la_pending_awards", "arms_licenses_due_renewal", "pending_rti_replies",
  "disaster_camps_capacity_utilisation"
];
```

---

## 3. P0 Org Model Blocker

[VERIFIED per `d05-admin-organogram.md §3`] ALL office-scoped capabilities (§2.1, §2.3, §2.16, §2.17, §2.24, §2.25) are blocked until the following exists in `location-service`:

```sql
-- [PROPOSED] Run as location-service migration 0003_offices.sql
CREATE TABLE hierarchy.offices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  office_code      VARCHAR(64) NOT NULL,
  name             TEXT NOT NULL,
  office_type      VARCHAR(64) NOT NULL,  -- collectorate, sdm_office, tehsil, block, ps, ulb, gp
  unit_id          UUID NOT NULL REFERENCES hierarchy.administrative_units(id),
  parent_office_id UUID REFERENCES hierarchy.offices(id),
  dept_code        VARCHAR(64) NOT NULL,  -- civil / revenue / police / health / education
  is_hq            BOOLEAN NOT NULL DEFAULT false,
  active           BOOLEAN NOT NULL DEFAULT true,
  effective_from   DATE NOT NULL,
  effective_to     DATE,
  ...standard cols...
);

CREATE TABLE hierarchy.positions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  position_code    VARCHAR(64) NOT NULL,  -- state-configurable (DC/Collector/DM all → same code)
  display_label    TEXT NOT NULL,         -- configurable per state/edition
  office_id        UUID NOT NULL REFERENCES hierarchy.offices(id),
  grade_pay_level  VARCHAR(16),
  is_hod           BOOLEAN NOT NULL DEFAULT false,
  fin_power_minor  BIGINT,               -- financial delegation limit (paise)
  ...standard cols...
);

CREATE TABLE hierarchy.postings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  employee_id      UUID NOT NULL,         -- FK → employee.hrms_employees (cross-service ref by opaque id)
  position_id      UUID NOT NULL REFERENCES hierarchy.positions(id),
  office_id        UUID NOT NULL REFERENCES hierarchy.offices(id),
  is_acting        BOOLEAN NOT NULL DEFAULT false,
  is_additional    BOOLEAN NOT NULL DEFAULT false,
  effective_from   DATE NOT NULL,
  effective_to     DATE,
  relieved_at      TIMESTAMP WITH TIME ZONE,
  ...standard cols...
);
```

These tables must be migrated before any office-scoped JWT claim (`office_id`, `position_id`) can be issued by identity-service.

---

## 4. Genuinely Missing for a Collectorate (Summary)

| Capability | Root cause |
|---|---|
| Disaster management | No service, no schema |
| Election coordination | No service; use workflow-service + new lightweight module |
| Arms/liquor/trade licensing | No service, no schema |
| Land acquisition proceedings | No service; case-parcels only covers disputed land in revenue courts |
| Revenue recovery (demand certificate / attachment / coercive recovery) | No service; court-service has compliance directions but no recovery workflow |
| CPGRAMS integration | Stub only (`CPGRAMS_API_STUB` constant, no HTTP client) |
| Service catalog for certificates | No catalog table; citizen-service has serviceId UUID but no catalog service |
| Inspection reports | No module |
| DigiLocker pull-documents | Token field exists in portal schema; no API call implemented |
| Office / position / posting model | P0 foundation gap across all services |

---

*Evidence base: `services/estab-service/src/modules/files/schema.ts`, `services/court-service/src/modules/config-registry/presets.ts`, `services/citizen-service/src/modules/helpdesk/domain.ts:1-2`, `services/citizen-service/src/modules/grievance/domain.ts`, `services/legal-service/src/modules/ecourts/adapter.ts:1-14`, `services/finance-service/src/shared/pfms.ts`, `services/court-service/src/modules/case-parcel/schema.ts`, `d05-admin-organogram.md §2-3`, `d23b-identity-config-assessment.md §2.1`, `docker exec civitasone-postgres psql -d civitas_court -c "\dt court.*"` (22 tables verified), `docker exec civitasone-postgres psql -c "\l"` (39 DBs verified).*
