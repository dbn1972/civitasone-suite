# D10 — Police (SP Office + Police Station) Capability Gap Assessment

**Lane:** L04 · **Date:** 2026-07-13  
**Reviewer role:** Police Administration Expert  
**Source branch:** `court-management-service` · repo at `/tmp/cms-wt`

> **PREREQUISITE BLOCKER:** The org model today is `Tenant → Department → User` with no office, position, posting, or jurisdiction domain. Police hierarchy (SP → DSP → Circle → Police Station → Beat) is fully absent from all schemas. See D06 (police organogram) for DDL. Everything in this report assumes D06 §5.2 DDL is implemented first.

> **PRIOR READING:** D06-police-organogram.md (hierarchy model), D05-admin-organogram.md (civil hierarchy prerequisite DDL), 08-tenant-isolation-report.md (tenancy: 7/10). Do not re-read those; evidence is cited inline.

---

## 1. Hard Design Rule — CCTNS/ICJS Boundary

**This must appear in every architecture decision record for the police vertical:**

| MUST LIVE IN CCTNS / ICJS (external statutory systems) | MUST NEVER enter CivitasOne |
|---|---|
| FIR registration, case number, case diary | FIR data, case diary entries |
| Investigation records, arrest memo | Criminal history of individuals |
| Confidential intelligence, source identities | Informer details, intelligence dossiers |
| Evidence register, malkhana (evidence custody) | Seized evidence inventory |
| Criminal antecedents, history-sheeter data | Criminal records |
| Court challan / charge-sheet | Case outcome/conviction data |
| Crime statistics at individual case level | Individual-level crime linkages |

**What CivitasOne MAY do with CCTNS/ICJS:**
1. Receive aggregate crime statistics by geographic unit for dashboard (read-only, API pull) [PROPOSED]
2. Verify FIR existence (firNo + psCode) to cross-reference a court summons in `court-service` [PROPOSED]
3. Receive summons/warrant compliance status updates via authorized ICJS webhook [PROPOSED]

```typescript
// [PROPOSED] packages/gov-adapters/src/cctns/client.ts
interface CctnsAdapter {
  getCrimeStatsByUnit(districtLgdCode: string, period: YearMonth): Promise<CrimeSummary>;
  verifyFirExists(firNo: string, psCode: string): Promise<{ exists: boolean; status: FirStatus }>;
}

interface IcjsAdapter {
  getSummonsComplianceStatus(summonsRef: string): Promise<SummonsStatus>;
  getWarrantStatus(warrantRef: string): Promise<WarrantStatus>;
}
```

All three integrations must go through `packages/gov-adapters` (not direct DB links or screen-scraped calls). The adapters must be read-only from CivitasOne's perspective. [PROPOSED]

---

## 2. Capability Classification Table

### 2A — Administrative Side (CAN live in this ERP)

| # | Capability | Mapped Service(s) | Verdict | Priority | Evidence |
|---|---|---|---|---|---|
| A01 | Police org hierarchy (DGP → Range → DIG → SP → DSP → Circle → PS → Beat) | location-service | **Requires-extension** | **P0** | D06: police unit types absent from `hierarchy.unit_types`; `police_station`, `beat`, `police_circle` not in schema |
| A02 | Police offices (SP Office, DSP Office, Police Station as entities) | location-service | **Requires-extension** | **P0** | `hierarchy.offices` table does not exist in DB; D04 §5 confirms no office registry |
| A03 | Rank & designation (DGP/ADGP/IG/DIG/SP/DSP/Insp/SI/ASI/HC/Const) | hrms-service | **Configurable** | **P0** | [VERIFIED] `hrmsDesignations(code, name, level, payGrade)` generic enough; seed data only needed |
| A04 | Police pay matrix (7th CPC armed police scales + state DA allowances) | payroll-service + hrms-service | **Configurable** | **P1** | [VERIFIED] `hrms_pay_matrices` generic; police allowances (PHQ, specialist) need edition config entries |
| A05 | Police cadre (IPS/state PPS cadre, cadre allotment, year-of-allotment) | hrms-service | **Requires-extension** | **P1** | [VERIFIED] `hrmsEmployees` has no `cadre`, `cadreAllotmentYear`, `batchYear` column; `hrmsDesignations` has no `cadreType` |
| A06 | Posting & transfer (IPS/PPS officer to SP/DIG/DGP post) | hrms-service | **Configurable** | **P1** | [VERIFIED] `lifecycle.hrms_transfer_orders(fromStation, toStation)` + `topics.ts:4 hrms.employee.transfer`; station is varchar — needs `toOfficeId` FK once offices exist |
| A07 | Service book (police-specific entries: posting to armed reserve, commendation, gallantry award) | hrms-service | **Configurable** | **P1** | [VERIFIED] `service_book.entries` generic; gallantry/commendation entry types need config |
| A08 | Leave & attendance (police-specific types: guard duty exemption, special duty leave, compensatory off after deployment) | hrms-service | **Configurable** | **P1** | [VERIFIED] leave module generic; police leave types (CL-police / EL / SL / SDL) need edition config |
| A09 | Pension & NPS for police (premature retirement, disability pension, family pension for killed-in-action) | hrms-service (pension module) | **Requires-extension** | **P2** | [VERIFIED] `hrms-service/src/app.ts:36 pensionRoutes`; generic NPS/OPS support present; KIA family pension needs new pension type |
| A10 | Training & skill development (basic training at police academy, refresher, specialisation) | hrms-service (training module) | **Configurable** | **P1** | [VERIFIED] `hrms-service/src/modules/training/routes.ts:18`; training_programs generic |
| A11 | Disciplinary proceedings (Rule 7 / Rule 14 CCS-CCA, Departmental Enquiry, police Act §42) | hrms-service (disciplinary module) | **Configurable** | **P1** | [VERIFIED] disciplinary module in `hrms-service/src/modules/disciplinary/` exists; police-specific charges need config |
| A12 | APARs / ACRs (police-specific APAR format per DPC DG office norms) | hrms-service (apar module) | **Configurable** | **P1** | [VERIFIED] `hrms-service/src/modules/apar/` exists; form fields configurable via metadata-service |
| A13 | Recruitment (police constable/SI selection via competitive exam, merit lists, physical test) | hrms-service (recruitment module) | **Requires-extension** | **P2** | Generic recruitment module exists; police-specific: physical efficiency test scores, driving license, category reservations (state police policy) |
| A14 | Welfare (police welfare fund, children's education allowance, martyrdom assistance) | hrms-service | **Requires-new-module** | **P2** | No welfare fund module exists; `social/routes.ts:41` covers only personal claims |
| A15 | Police housing & residential quarters | estab-service (facilities) + new | **Requires-extension** | **P2** | [VERIFIED] `estab-service/src/modules/facilities/` exists; police quarter allotment (waiting list, type A/B/C quarters) needs extension |
| A16 | Finance & budget (police budget, DPC/DIG/HQ allocations, contingency) | finance-service | **Configurable** | **P0** | [VERIFIED] HOA codes + DDO/PAO in `org.legal_entities`; police HOA codes need seed configuration |
| A17 | Procurement (vehicles, uniforms, equipment, arms accessories — NOT ammunition) | procurement-service | **Fully-available** | **P0** | [VERIFIED] GFR procurement, tender, GeM, PO, GRN all present in `procurement-service` |
| A18 | Stores / police station stores (stationery, uniform stock, consumables) | inventory-service + stock-service | **Fully-available** | **P0** | [VERIFIED] item catalog, stores, stock movements in `inventory-service` |
| A19 | Arms & ammunition register (licensed arms per officer, armory register) | — | **Requires-new-module** | **P1** | Zero evidence of arms/armory concept anywhere in codebase; `grep arms/ammunition` returned 0 hits in services/ |
| A20 | Fleet & fuel (police vehicles, fuel log, challan/maintenance) | asset-service | **Configurable** | **P1** | [VERIFIED] `asset-service` lifecycle + `maintenance.asset_work_orders`; vehicle fleet managed as asset class with `orgUnit` field |
| A21 | Police Lines / Barracks administration | estab-service (facilities) | **Requires-extension** | **P2** | Facilities module covers physical space; police lines (parade ground, barracks, quarter allocation) needs extension |
| A22 | Duty roster & shift scheduling (station guard duty, beat duty, escort) | — | **Requires-new-module** | **P1** | No duty-roster concept exists; visitor-service VIP escort uses `duty-roster` only as a label for a local array (`vip/domain.ts:9`) — not a persisted duty-roster service |
| A23 | Festival / event / election / disaster deployment | — | **Requires-new-module** | **P1** | Zero evidence of deployment management, bandobast planning, force requisition anywhere in codebase |
| A24 | Law & order planning (route plans, VIP protection orders, security bandobast) | — | **Requires-new-module** | **P2** | No L&O module; this is operational planning, NOT FIR/criminal data |
| A25 | Station inspection checklist (SP/DSP inspection of police station) | — | **Requires-new-module** | **P2** | No inspection module exists for police stations; generic audit-service covers statutory paras, not field inspection |
| A26 | Public grievance (police complaints, CPGRAMS routing to SP) | citizen-service | **Configurable** | **P1** | [VERIFIED] `citizen-service` grievance + SLA engine + CPGRAMS stub; route complaints to police department SLA rules |
| A27 | Internal eOffice / file movement (SP office noting, DIG office DFA) | estab-service | **Fully-available** | **P0** | [VERIFIED] estab-service eOffice complete; file classification `top_secret/secret/confidential` already supported |
| A28 | Control room operations log | — | **Requires-new-module** | **P2** | No control-room ops module; separate from telephony-service (which handles IVR/calls, not PCR log) |
| A29 | Inter-office coordination (DIG → SP, SP → DSP directives) | workflow-service + estab-service | **Configurable** | **P1** | Workflow BPMN engine + eOffice DFA can route between police offices once office hierarchy is built |
| A30 | Crime statistics dashboard (from CCTNS API — read only) | analytics-service + gov-adapters | **Requires-new-module** | **P2** | analytics-service can host the dashboard; CCTNS adapter (packages/gov-adapters) must be built |

### 2B — External (INTEGRATE, never duplicate)

| # | Capability | Statutory system | Integration approach | Priority |
|---|---|---|---|---|
| B01 | FIR registration & case number | CCTNS / State Police | CCTNS read API only (verify FIR exists) | P2 |
| B02 | Investigation case diary | CCTNS | **No integration** — access via CCTNS portal only | — |
| B03 | Criminal history / antecedents | CCTNS / NAFIS | **No integration** — classified network only | — |
| B04 | Evidence management / malkhana | CCTNS / State EM | **No integration** | — |
| B05 | Confidential intelligence | State Intel / IB | **No integration** — classified network only | — |
| B06 | Court summons/warrant status | ICJS | ICJS read API → court-service only | P2 |
| B07 | Forensic lab results | FSL systems | **No integration** — forensic classified systems | — |
| B08 | Court prosecution data | ICJS / eCourts | CivitasOne court-service integrates via ICJS API (NOT via ERP police module) | P2 |

### 2C — Should NOT be in this ERP at all

| Capability | Reason |
|---|---|
| FIR / case diary / criminal records | Statutory: CCTNS is system of record by MHA mandate |
| Criminal intelligence / informer data | Classified; network-separated |
| Evidence custody chain | Forensic integrity requires forensic-grade system |
| CCTNS screen-scraping or DB replication | Violates MHA CCTNS Policy 2.0 |

---

## 3. Generic Modules That Serve Police Admin Without Modification

The following generic modules serve the administrative (non-FIR) police use case from day one, requiring only configuration (seed data, role names, HOA codes), not code changes:

| Module | Service | Police use | Required config |
|---|---|---|---|
| eOffice / file movement | estab-service | SP/DIG/DGP office noting, DFA | Office IDs once D06 hierarchy is built |
| Procurement (GFR) | procurement-service | Vehicles, uniforms, equipment | Police department code as approver role |
| Stores | inventory-service + stock-service | Station stationery, uniform | Item categories for police stores |
| Finance / budget | finance-service | Police HOA codes (DGP/Range/SP) | HOA seed data per state |
| Designation / pay matrix | hrms-service | Constable→DGP pay scales | Police pay bands in `hrms_pay_structures` |
| Leave / attendance | hrms-service | Police leave types | Edition config for police leave types |
| Training | hrms-service | Police academy programs | Training categories |
| Disciplinary (Rule 14 / Police Act) | hrms-service | DE proceedings, major/minor penalty | Charge type seed data |
| Legal litigation | legal-service | Cases against police, dept appeals | Case category config |
| Asset register | asset-service | Vehicle fleet, equipment | Asset category = 'vehicle', 'equipment' |
| Grievance / CPGRAMS | citizen-service | Public complaints to SP | Department routing rule for police |
| Knowledge / document management | knowledge-service | SOPs, GOs, circulars | No change needed |
| Meeting / committee | meeting-service | DPC, ADPC, Range conference | No change needed |

---

## 4. Police Security Domain Requirement

Police administrative data (posting lists, duty deployment, bandobast plans, station inspection reports) is NOT classified intelligence, but it IS sensitive law-enforcement data requiring a separate security domain from general civil-administration data.

**[PROPOSED] Security domain isolation for police:**

```sql
-- [PROPOSED] Add to tenant.settings JSONB or a new security-domain config table
-- police_admin_domain: restricts data visibility so that:
-- 1. A civil-admin officer (SDM) cannot read police posting lists
-- 2. Police admin officers cannot read civil revenue records
-- 3. The SP can read his district's police posting; the IG can read range postings; the DGP reads all
-- Implementation: add `security_domain = 'police'` column to hrms_departments
-- RLS policy extended: WHERE (app.user_domain = security_domain OR app.user_domain = 'all')

ALTER TABLE employee.hrms_departments ADD COLUMN security_domain varchar(32) DEFAULT 'civil';
-- Police departments get: UPDATE hrms_departments SET security_domain = 'police' WHERE type IN (...)

-- [PROPOSED] JWT claim extension:
-- { "role": "hrms_admin", "tenantId": "...", "securityDomain": "police" }
-- packages/auth must validate securityDomain claim; GUC: app.security_domain
```

This is the only scope gate needed. Intelligence-grade classification remains entirely outside this system.

---

## 5. Required New Modules (Police-Specific)

These capabilities have zero analog in the existing 38 services and require net-new modules:

### 5.1 Arms & Ammunition Register (`police-arms` module in hrms-service or standalone)

```sql
-- [PROPOSED] police.arms_register
CREATE TABLE police.arms_register (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  office_id        uuid NOT NULL,        -- references hierarchy.offices
  weapon_type      varchar(32) NOT NULL, -- rifle|pistol|revolver|carbine|shotgun
  make_model       varchar(128),
  serial_no        varchar(64) NOT NULL,
  calibre          varchar(16),
  condition        varchar(16) NOT NULL DEFAULT 'serviceable', -- serviceable|unserviceable|condemned
  assigned_to      uuid,                 -- references hrms_employees (bearer)
  licenced_to_unit uuid NOT NULL,        -- references hierarchy.offices
  acquisition_date date,
  last_verified_at timestamptz,
  verified_by      uuid,
  notes            text,
  -- standard cols
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);
-- RLS: FORCE ROW LEVEL SECURITY + security_domain = 'police' gate

-- [PROPOSED] police.ammunition_stock (per station/armory)
CREATE TABLE police.ammunition_stock (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  office_id   uuid NOT NULL,
  ammo_type   varchar(32) NOT NULL,  -- 9mm|.303|12bore|SG
  rounds_in   int NOT NULL DEFAULT 0,
  rounds_out  int NOT NULL DEFAULT 0,
  rounds_bal  int NOT NULL DEFAULT 0,
  period_date date NOT NULL,
  verified_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL, updated_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);
```

**Note:** This register tracks administrative custody (which weapon is assigned to which officer). It is NOT a crime-intelligence record. It mirrors the paper Arms Register maintained at every police station per the Arms Act 1959.

### 5.2 Duty Roster (`police-roster` module)

```sql
-- [PROPOSED] police.duty_rosters
CREATE TABLE police.duty_rosters (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  office_id       uuid NOT NULL,       -- police station / DSP office
  roster_date     date NOT NULL,
  shift           varchar(16) NOT NULL, -- morning|evening|night|general
  duty_type       varchar(32) NOT NULL, -- guard|beat|patrol|escort|deployment
  employee_id     uuid NOT NULL,
  deployment_ref  uuid,                -- references police.deployments.id
  status          varchar(16) NOT NULL DEFAULT 'scheduled',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);
```

### 5.3 Deployment Management (`police-deployment` module)

```sql
-- [PROPOSED] police.deployments
CREATE TABLE police.deployments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  deployment_type  varchar(32) NOT NULL, -- election|festival|vip_visit|disaster|law_and_order|examination
  name             text NOT NULL,
  location_unit_id uuid NOT NULL,       -- administrative_units reference
  from_date        date NOT NULL,
  to_date          date NOT NULL,
  requisition_by   uuid,                -- requesting authority (DM/SDM/Commissioner)
  sanctioned_by    uuid,
  force_required   jsonb NOT NULL DEFAULT '{}', -- { "constable": 50, "si": 5, "dsp": 1 }
  force_deployed   jsonb NOT NULL DEFAULT '{}',
  status           varchar(24) NOT NULL DEFAULT 'planned',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);
```

This captures cross-department requests (District Collector requisitions force from SP) — administrative coordination, not operational FIR data.

### 5.4 Station Inspection (`police-inspection` module)

```sql
-- [PROPOSED] police.station_inspections
CREATE TABLE police.station_inspections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  inspected_office uuid NOT NULL,      -- police station office_id
  inspector_id     uuid NOT NULL,      -- SP/ASP/DSP doing the inspection
  inspection_date  date NOT NULL,
  inspection_type  varchar(32) NOT NULL, -- sp_inspection|asp_inspection|dsp_inspection|surprise
  findings         jsonb NOT NULL DEFAULT '[]', -- array of {category, finding, severity, action_required}
  overall_rating   varchar(16),         -- excellent|good|satisfactory|poor
  action_taken_by  date,
  status           varchar(16) NOT NULL DEFAULT 'draft',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);
```

---

## 6. Generic Module Gaps That Need Extension (Not New Modules)

| Gap | Service | Change needed | Priority |
|---|---|---|---|
| `hrmsEmployees`: no `cadre` (IPS/PPS/state), no `cadreAllotmentYear` | hrms-service | Add columns to `employee.hrms_employees` migration | P1 |
| `hrmsDesignations`: no `cadreType`, no `rankOrder` for police seniority | hrms-service | Add `cadre_type varchar(16)`, `rank_order int` to `hrms_designations` | P1 |
| `lifecycle.hrms_transfer_orders`: `toStation` is varchar, cannot FK to police station office | hrms-service | Add `to_office_id uuid` (once offices table exists) | P1 |
| `citizen-service` SLA rules: no routing to police department | citizen-service | Seed SLA rule for `department_type = 'police'` → `maxDays=15` (police grievance SLA per CPGRAMS) | P1 |
| `hrms_departments.security_domain` absent | hrms-service | New migration adding `security_domain varchar(32) DEFAULT 'civil'` | P1 |
| `packages/gov-adapters`: CCTNS + ICJS stubs absent | gov-adapters (new package) | Create `packages/gov-adapters/src/cctns/client.ts` + `icjs/client.ts` | P2 |

---

## 7. Mapping: How Much of Police Admin Can Generic Modules Serve?

```
Police Admin Function              Generic Coverage     Gap
────────────────────────────────────────────────────────────────────────
Establishment & HR                 ████████░░  80%      cadre cols, police leave types
Pay & payroll                      █████████░  90%      allowance config only
Pension                            ████████░░  80%      KIA family pension new type
Training & academy                 █████████░  90%      training category config
Disciplinary proceedings           █████████░  90%      charge type config
Service book (ACR/APAR)           █████████░  90%      APAR form fields via metadata
Transfers & postings              ████████░░  80%      needs toOfficeId FK + cadre col
Finance & budget                   █████████░  90%      HOA code seed data only
Procurement (vehicles/equip)       █████████░  90%      no code change needed
Stores (station supplies)          █████████░  90%      no code change needed
Asset register (vehicles)          █████████░  90%      asset category config
eOffice (SP/DIG file noting)      ██████████  100%     works now once office entity exists
Legal cases against police         █████████░  90%      legal-service config
Grievance/CPGRAMS                  ████████░░  80%      department routing config
Meetings (DPC, conferences)        ██████████  100%     no change needed
────────────────────────────────────────────────────────────────────────
Duty roster / shift scheduling     ░░░░░░░░░░   0%      NEW MODULE required
Deployment management              ░░░░░░░░░░   0%      NEW MODULE required
Arms & ammunition register         ░░░░░░░░░░   0%      NEW MODULE required
Station inspection                 ░░░░░░░░░░   0%      NEW MODULE required
Control room operations log        ░░░░░░░░░░   0%      NEW MODULE required
L&O planning / bandobast           ░░░░░░░░░░   0%      NEW MODULE required (P2)
CCTNS crime stats dashboard        ░░░░░░░░░░   0%      gov-adapters + analytics ext
Police welfare fund                ░░░░░░░░░░   0%      NEW MODULE (P2)
```

---

## 8. Priority-Ordered Gap Register

| ID | Gap | Priority | Service | Implementation |
|---|---|---|---|---|
| POL-01 | Police hierarchy not in DB (D06 prerequisite) | **P0** | location-service | D06 §7 DDL — P-01 to P-05 |
| POL-02 | Police HOA codes not seeded in finance-service | **P0** | finance-service | Seed `org.legal_entities` with police DDO/PAO codes |
| POL-03 | Police department types absent from `dept-domain.ts` | **P0** | hrms-service | Add `'sp_office','dsp_office','police_station','police_range','armed_reserve'` to `STATE_GOVT_TYPES` |
| POL-04 | eOffice routing needs police office entities | **P0** | estab-service | Resolved by POL-01 (office registry); no code change in estab-service itself |
| POL-05 | `hrmsEmployees.cadre` column absent | **P1** | hrms-service | `ALTER TABLE employee.hrms_employees ADD COLUMN cadre varchar(16)` (IPS/PPS/state) |
| POL-06 | `hrmsDesignations.cadreType + rankOrder` absent | **P1** | hrms-service | New migration; seed DGP→Constable designation rows |
| POL-07 | Transfer lifecycle uses varchar station; needs office FK | **P1** | hrms-service | `ALTER TABLE lifecycle.hrms_transfer_orders ADD COLUMN to_office_id uuid` |
| POL-08 | `hrms_departments.security_domain` absent | **P1** | hrms-service | New migration; RLS policy update for domain-scoped reads |
| POL-09 | Police leave types not in edition config | **P1** | hrms-service | Add to `admin.config_entries`: police leave types (SDL, guard duty comp-off) |
| POL-10 | Duty roster module absent | **P1** | new police-admin service | `police.duty_rosters` DDL + 7-file CQRS module |
| POL-11 | Deployment management module absent | **P1** | new police-admin service | `police.deployments` DDL + routes |
| POL-12 | Arms & ammunition register absent | **P1** | new police-admin service | `police.arms_register` + `police.ammunition_stock` DDL + routes; security_domain = 'police' |
| POL-13 | Citizen grievance not routed to police dept | **P1** | citizen-service | Seed SLA rule `jurisdiction_type='police'`, `max_days=15` |
| POL-14 | Station inspection module absent | **P2** | new police-admin service | `police.station_inspections` DDL + routes |
| POL-15 | KIA family pension type absent | **P2** | hrms-service | Add `pension_type='family_kia'` to pension module |
| POL-16 | CCTNS adapter absent in gov-adapters | **P2** | packages/gov-adapters | New package; two methods only (crime stats + FIR verify) |
| POL-17 | ICJS summons/warrant status integration | **P2** | packages/gov-adapters + court-service | ICJS client + court-service consumer for warrant status events |
| POL-18 | Police welfare fund module | **P2** | new module | `police.welfare_fund_claims` DDL |
| POL-19 | Control room operations log | **P2** | new police-admin service | Separate PSTN/PCR log module; telephony-service not suitable |
| POL-20 | L&O planning / bandobast | **P3** | new police-admin service | Operational planning module; requires deployment module as prerequisite |
| POL-21 | Commissionerate topology config | **P3** | location-service | D06 §5.3 — DCP path vs SP path; config-only once office table exists |
| POL-22 | CCTNS crime stats in analytics dashboard | **P3** | analytics-service + gov-adapters | Read-only aggregate pull; requires POL-16 first |

---

## 9. Verdict Summary

| Category | Status |
|---|---|
| Police hierarchy in DB | **ABSENT** — P0 blocker (D06) |
| Police HR admin (rank, transfer, service book, training) | **Configurable** (generic HRMS covers ~80%; cadre cols needed) |
| Finance, procurement, stores, asset for police | **Fully-available** (config only) |
| eOffice / file noting at police offices | **Configurable** (once office entity exists) |
| Public grievance routing to SP | **Configurable** (SLA rule seed) |
| Duty roster | **ABSENT** — P1 new module |
| Deployment management | **ABSENT** — P1 new module |
| Arms & ammunition register | **ABSENT** — P1 new module |
| Station inspection | **ABSENT** — P2 new module |
| CCTNS / ICJS integration | **ABSENT** — P2; read-only adapters only; FIR/criminal data must NEVER enter this system |

**Police admin readiness score: 2/10** (hierarchy absent; admin modules configurable but untested in police context; 4 new modules needed before district pilot).
