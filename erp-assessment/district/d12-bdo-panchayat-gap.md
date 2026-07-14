# D12 — BDO / Block / Panchayat / Rural Development Capability Gap Assessment

**Lane:** L04 · **Date:** 2026-07-13  
**Reviewer role:** Rural Development / Panchayati Raj Expert  
**Source branch:** `court-management-service` · repo at `/tmp/cms-wt`

> **PREREQUISITE BLOCKER:** The org model today is `Tenant → Department → User` with no office, block, gram panchayat, or ward entity. Block Development Officer (BDO) office and Gram Panchayat cannot be represented as distinct administrative units today. [VERIFIED: D04 §5; location-service `hierarchy/validators.ts` — `block` and `gp` exist as unit types in code but `ward`, `tehsil`, `ulb` are absent and no `office` registry exists] The D05 prerequisite DDL must land first.

> **PRIOR READING:** D04-module-inventory.md, D05-admin-organogram.md, D09-collectorate-gap.md, 08-tenant-isolation-report.md. Evidence cited inline.

---

## 1. Key Decision: Configure Existing vs. New RD Module

**Question:** Can existing project-service + finance + procurement + citizen + workflow + asset + analytics be CONFIGURED to serve rural development, or is a dedicated RD module required?

**Evidence gathered (grep results):**

| Concept | Result | Evidence |
|---|---|---|
| `scheme` in project-service | **EXISTS** | `project-service/src/modules/scheme/schema.ts` — `project_schemes`, `project_scheme_components`, `project_fund_releases` |
| `beneficiary` in grant-service | **EXISTS** | `grant-service/src/modules/beneficiary/schema.ts` — `grant_beneficiaries`, `grant_bank_accounts`, `grant_aadhaar_links` |
| `utilisation` / `uc_statement` | **EXISTS** | `project-service/src/modules/utilisation/schema.ts` — `project_uc_statements`, `project_uc_items`; also `grant-service/src/modules/utilisation/schema.ts` |
| `geotag` / `geo_tag` | **EXISTS** | `project-service/src/modules/geo/schema.ts` — `project_geo_tags`, `project_site_photos` |
| `technical_sanction` | **ABSENT** | 0 grep hits across all services |
| `works_order` (RD works) | **ABSENT** | `asset.work_orders` exist in asset-service but are MAINTENANCE work orders, not rural-works contract orders |
| `social_audit` | **ABSENT** | 0 grep hits across all services |
| `gram_sabha` / `panchayat_plan` / `gpdp` | **ABSENT** | 0 grep hits |
| `job_card` / `muster_roll` (MGNREGA) | **ABSENT** | 0 grep hits |
| `convergence` / `multi_scheme` | **ABSENT** | 0 grep hits |
| `nrega` / `mgnrega` / `pmgsy` / `pmay` | **ABSENT** | 0 grep hits |
| `administrative_approval` | **ABSENT** | 0 grep hits |
| `technical_estimate` | **ABSENT** | 0 grep hits |

**Verdict:** The existing project-service and grant-service cover approximately 40–50% of RD workflow by reuse. The remaining 50–60% — technical sanction, works management, social audit, GP planning (GPDP), MGNREGA job card/muster roll, and scheme convergence — requires either extension of project-service or a new `rd-service`. Given the regulatory complexity and module isolation rules (one service = one bounded context), a new `rd-service` is recommended for the MGNREGA/MGNREGS-specific concepts, while project-service and grant-service are CONFIGURED for general scheme execution.

---

## 2. Capability Classification Table

| # | Capability | Mapped Service(s) | Verdict | Priority | Evidence |
|---|---|---|---|---|---|
| R01 | Block administration (BDO office as entity, staff, office management) | location-service + hrms-service + estab-service | **Requires-extension** | **P0** | [VERIFIED] `block` unit type exists in code (`hierarchy/validators.ts`) but not in DB; no BDO office entity; D05 prerequisite must land |
| R02 | Panchayat coordination (GP as administrative unit, Pradhan/Secretary) | location-service + hrms-service | **Requires-extension** | **P0** | [VERIFIED] `gp` unit type in code; `ward` absent; no GP office entity |
| R03 | Scheme planning (CSS/state scheme definitions at block level) | project-service (scheme module) | **Configurable** | **P0** | [VERIFIED] `project_schemes(code, name, type, fundingPattern, totalOutlayMinor, sanctionRef)` — generic, can hold PMGSY/PMAY/MGNREGA scheme definitions; `type varchar(24)` accepts any scheme category |
| R04 | Beneficiary management (individual/household entitlement tracking) | grant-service (beneficiary module) | **Configurable (needs extension)** | **P0** | [VERIFIED] `grant_beneficiaries(name, type, category, age, incomeAnnualMinor, geography text)` — `geography` is free-text (not FK to GP/ward); `category` text (needs SC/ST/OBC/BPL structured); Aadhaar DPDP masking (last4 + SHA-256 token) already implemented at `grant_aadhaar_links` |
| R05 | Works management (work order, DPR, technical estimate, completion certificate) | project-service | **Requires-extension** | **P0** | [VERIFIED] `project_projects(dprCostMinor, sanctionedMinor, sanctionRef)` exists; BUT no `technical_sanction` record, no `administrative_approval` record, no `completion_certificate` entity — these are mandatory for rural public works |
| R06 | Technical sanction | — | **Requires-new-module** | **P0** | 0 hits for `technical_sanction` anywhere; must be added as `rd.technical_sanctions` table; links DPR → engineer's sanction → AA → work order |
| R07 | Administrative approval (AA) by Collector/BDO | workflow-service + new | **Requires-extension** | **P0** | No AA concept; workflow-service BPMN engine can drive the approval DAG once `rd.technical_sanctions` exists |
| R08 | Fund release (installment-based, PFMS-linked) | project-service (scheme module) | **Configurable** | **P1** | [VERIFIED] `project_fund_releases(releaseNo, amountMinor, toEntity, pfmsRef, sanctionedAt, disbursedAt)` — PFMS reference field exists; fund release flow already wired |
| R09 | Utilisation Certificate (UC) submission & validation | project-service (utilisation module) | **Configurable** | **P1** | [VERIFIED] `project_uc_statements(ucNo, periodFrom, periodTo, releasedMinor, expenditureMinor, balanceMinor)` + `project_uc_items(ucStatementId, componentId)`; UC validation also exists in `grant-service/src/modules/uc-validation/routes.ts:20` |
| R10 | Geo-tagged progress (photo + lat/lon timestamped before/during/after) | project-service (geo module) | **Configurable (needs extension)** | **P1** | [VERIFIED] `project_geo_tags(lat, lon, locationName, taggedBy, taggedAt)` + `project_site_photos(s3Key, geoTagId)` exist; CRITICAL GAP: no `device_timestamp` vs `server_timestamp` split for tamper detection; no `stage` field (pre/during/post construction); no GPS accuracy field |
| R11 | Inspection (BDO / district officer field inspection of works) | — | **Requires-new-module** | **P1** | Zero inspection module; procurement-service has GRN inspection for goods receipt — not applicable to civil works |
| R12 | Social audit | — | **Requires-new-module** | **P1** | 0 hits anywhere; social audit is a statutory requirement under MGNREGA Act §17; needs `rd.social_audits`, `rd.social_audit_findings`, `rd.social_audit_responses` |
| R13 | Asset creation record (road built, well constructed, school room added) | asset-service | **Configurable** | **P2** | [VERIFIED] asset-service lifecycle complete; `register.orgUnit varchar(64)` present; newly-created rural assets link to project completion |
| R14 | Contractor / agency management (rural works contractors, JE, RA bill) | procurement-service | **Requires-extension** | **P1** | [VERIFIED] procurement has vendor/contractor register; BUT no `running_account_bill` (RA bill), no `measurement_book`, no `quality_check_test` — these are civil works-specific procurement artifacts |
| R15 | Rural livelihood monitoring (SHG, JLG, SRLM scheme tracking) | grant-service | **Requires-extension** | **P2** | `grant_beneficiaries.type = 'group'` would serve SHG group beneficiary; no `shg_id`, `bank_linkage`, `revolving_fund` fields |
| R16 | GP-level reporting (Panchayat Darpan, PFMS GP dashboard) | analytics-service + report-service | **Requires-extension** | **P1** | analytics-service KPI engine present; no GP-scoped tenant context (block/GP must be registered as sub-tenant nodes first) |
| R17 | State + Ministry scheme integration (PFMS, NIC scheme portals, DISHA) | — | **Requires-new-module** | **P2** | packages/gov-adapters does not exist; no PFMS client, no NIC scheme API adapter |
| R18 | Grievance (block/GP level complaints, CPGRAMS) | citizen-service | **Configurable** | **P1** | [VERIFIED] citizen-service complete grievance + CPGRAMS stub; needs department routing rule for BDO/GP |
| R19 | Annual plan / block plan (Block Annual Plan, GPDP) | — | **Requires-new-module** | **P2** | No planning module; GPDP (Gram Panchayat Development Plan) is mandatory under 14th/15th Finance Commission; needs `rd.gp_plans`, convergence across schemes |
| R20 | Muster roll / job card (MGNREGA) | — | **Requires-new-module** | **P1** | 0 hits anywhere; MGNREGA Act §§3–10 mandate job card registration, demand-based work allocation, muster roll, wage payment within 15 days |
| R21 | Wage disbursement (MGNREGA direct DBT to worker accounts) | grant-service (disbursement) | **Requires-extension** | **P1** | grant-service disbursement already has NACH/PFMS paths; MGNREGA wage needs a muster-roll-linked payment cycle — new disbursement type |

---

## 3. Key Reuse Verdict: What Existing Modules Cover

### 3.1 project-service — What It Covers for RD

```
project-service/src/modules/scheme/schema.ts
  project_schemes        → RD scheme definitions (PMGSY, PMAY, MNREGA, JJM etc.)
  project_scheme_comps   → Scheme components (road works / water supply / housing)
  project_fund_releases  → Fund release installments with PFMS ref [VERIFIED]

project-service/src/modules/utilisation/schema.ts
  project_uc_statements  → UC submission (ucNo, periodFrom/To, expenditure) [VERIFIED]
  project_uc_items       → Per-component expenditure split [VERIFIED]

project-service/src/modules/progress/schema.ts
  project_physical_progress  → % completion per period [VERIFIED]
  project_financial_progress → Expenditure per period [VERIFIED]
  project_dprs               → DPR document linking [VERIFIED]

project-service/src/modules/geo/schema.ts
  project_geo_tags       → GPS lat/lon per project [VERIFIED]
  project_site_photos    → S3-linked photos per geo-tag [VERIFIED]

project-service/src/modules/project/schema.ts
  project_projects       → Works: dprCostMinor, sanctionedMinor, sanctionRef, agencyRef [VERIFIED]
  project_tasks          → WBS tasks (civil works breakdown: earthwork / masonry / finishing)
  project_milestones     → Milestone-linked payments [VERIFIED]
```

**What's MISSING for RD in project-service:**
1. `technical_sanction_id` — no FK from project to a technical sanction record
2. `administrative_approval_id` — no AA approval stage
3. `completion_certificate` — no CC entity
4. `measurement_book_id` — no MB record
5. `work_order_no` — `agencyRef text` is a freeform string, not a structured work order

### 3.2 grant-service — What It Covers for RD

```
grant-service/src/modules/beneficiary/schema.ts
  grant_beneficiaries    → Individual/household beneficiary (name, category, income, geography) [VERIFIED]
  grant_bank_accounts    → DBT bank account with IFSC [VERIFIED]
  grant_aadhaar_links    → DPDP-compliant Aadhaar token linkage [VERIFIED]

grant-service/src/modules/scheme/schema.ts
  grant_schemes          → Scheme budget envelope (budget_minor, disbursed_minor, eligibility) [VERIFIED]
  grant_eligibility_criteria → criterion_key: age|income|category|geography [VERIFIED]

grant-service/src/modules/utilisation/schema.ts
  grant_uc_statements    → UC with compliance reports and audit paras [VERIFIED]
  grant_compliance_reports → Compliance reporting
  grant_audit_paras      → Audit para tracking for grants
```

**What's MISSING for RD in grant-service:**
1. `grantBeneficiaries.geography` is `text` not a FK — cannot filter/aggregate by GP/block/district
2. No `household_id` (schemes like PMAY target households, not individuals)
3. No `scheme_type` field distinguishing CSS / state scheme / MGNREGA wage payment
4. No MGNREGA-specific fields: `job_card_no`, `demanded_days`, `allotted_days`, `worked_days`
5. `grant_uc_validations` exists but no flow to publish UC to NIC/PFMS portal

---

## 4. Detailed Gap Analysis: Five Critical Missing Concepts

### 4.1 Technical Sanction [ABSENT — P0]

Every rural public work must pass through:
`DPR prepared → Technical Sanction (by engineer) → Administrative Approval (by BDO/Collector) → Work Order → Execution → Measurement → Running-Account Bill → Completion Certificate → Asset Creation`

None of this approval chain exists in the ERP today.

```sql
-- [PROPOSED] rd.technical_sanctions
CREATE TABLE rd.technical_sanctions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  project_id        uuid NOT NULL,         -- project.project_projects.id
  ts_no             text NOT NULL,
  ts_date           date NOT NULL,
  dpr_cost_minor    bigint NOT NULL,
  ts_cost_minor     bigint NOT NULL,        -- may differ from DPR cost after scrutiny
  scrutiny_remarks  text,
  technical_by      uuid NOT NULL,          -- JE/AE who gave TS
  approved_by       uuid,                   -- AE/EE who countersigned
  status            varchar(16) NOT NULL DEFAULT 'submitted',  -- submitted|approved|returned|rejected
  aa_id             uuid,                   -- rd.administrative_approvals.id (set after AA)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);

-- [PROPOSED] rd.administrative_approvals
CREATE TABLE rd.administrative_approvals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  ts_id            uuid NOT NULL,            -- rd.technical_sanctions.id
  aa_no            text NOT NULL,
  aa_date          date NOT NULL,
  aa_cost_minor    bigint NOT NULL,
  approved_by      uuid NOT NULL,            -- BDO/Collector
  office_id        uuid NOT NULL,
  conditions       text,
  status           varchar(16) NOT NULL DEFAULT 'approved',
  work_order_id    uuid,                     -- rd.work_orders.id
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);

-- [PROPOSED] rd.work_orders
CREATE TABLE rd.work_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  aa_id            uuid NOT NULL,
  wo_no            text NOT NULL,
  wo_date          date NOT NULL,
  agency_id        uuid NOT NULL,            -- procurement.vendors.id (opaque ref)
  work_value_minor bigint NOT NULL,
  start_date       date,
  completion_date  date,
  status           varchar(24) NOT NULL DEFAULT 'issued',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);
```

### 4.2 Social Audit [ABSENT — P1]

MGNREGA Act §17 makes social audit mandatory. Social audits must be conducted by the Gram Sabha at least twice a year. No analog exists in the ERP.

```sql
-- [PROPOSED] rd.social_audits
CREATE TABLE rd.social_audits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  gp_unit_id        uuid NOT NULL,           -- location.administrative_units (GP level)
  audit_date        date NOT NULL,
  conducted_by      text NOT NULL,            -- social audit unit name
  facilitator_id    uuid,                     -- state social audit authority officer
  schemes_audited   text[] NOT NULL DEFAULT '{}',  -- scheme codes
  gram_sabha_date   date,
  status            varchar(24) NOT NULL DEFAULT 'planned',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);

-- [PROPOSED] rd.social_audit_findings
CREATE TABLE rd.social_audit_findings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  audit_id         uuid NOT NULL,
  work_id          uuid,                      -- optional: project.project_projects.id
  beneficiary_id   uuid,                      -- optional: grant.grant_beneficiaries.id
  finding_type     varchar(32) NOT NULL,      -- muster_roll_irregularity|wage_delay|fake_entry|material_deficiency|misappropriation
  description      text NOT NULL,
  amount_minor     bigint DEFAULT 0,
  severity         varchar(16) NOT NULL DEFAULT 'minor',
  status           varchar(16) NOT NULL DEFAULT 'open',
  action_taken     text,
  closed_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);
```

### 4.3 Geo-tagged Progress — Missing Anti-Tampering Fields [P1 extension]

Existing `project_geo_tags` captures lat/lon but has no way to prevent post-facto photo submission or GPS spoofing. Rural development monitoring requires:

```sql
-- [PROPOSED] Extension to project.project_geo_tags:
ALTER TABLE geo.project_geo_tags ADD COLUMN stage varchar(16); -- pre_work|during|post_completion
ALTER TABLE geo.project_geo_tags ADD COLUMN device_timestamp   timestamptz; -- from mobile device EXIF
ALTER TABLE geo.project_geo_tags ADD COLUMN gps_accuracy_m     numeric(8,2); -- GPS accuracy in metres
ALTER TABLE geo.project_geo_tags ADD COLUMN photo_hash          text;         -- SHA-256 of uploaded photo
ALTER TABLE geo.project_geo_tags ADD COLUMN upload_method       varchar(16) DEFAULT 'manual'; -- mobile_app|portal|api
```

The `photo_hash` + `device_timestamp` + `server_received_at` (existing `taggedAt`) together make before/during/after photo falsification detectable. This is a P1 extension of the existing table, not a new module.

### 4.4 MGNREGA Job Card / Muster Roll [ABSENT — P1]

MGNREGS is the largest rural employment programme. Its data model is legally mandated. Zero evidence of this in the codebase. This requires a new `rd-service` module:

```sql
-- [PROPOSED] rd.job_cards
CREATE TABLE rd.job_cards (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  gp_unit_id       uuid NOT NULL,            -- GP administrative unit
  job_card_no      text NOT NULL,
  household_head_id uuid NOT NULL,           -- grant_beneficiaries.id (household)
  registration_date date NOT NULL,
  family_members   jsonb NOT NULL DEFAULT '[]', -- [{name, age, gender, aadhaarToken}]
  status           varchar(16) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);

-- [PROPOSED] rd.muster_rolls
CREATE TABLE rd.muster_rolls (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  work_id          uuid NOT NULL,            -- project.project_projects.id
  mr_no            text NOT NULL,
  period_from      date NOT NULL,
  period_to        date NOT NULL,
  status           varchar(16) NOT NULL DEFAULT 'open',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);

-- [PROPOSED] rd.muster_roll_entries
CREATE TABLE rd.muster_roll_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  muster_roll_id   uuid NOT NULL,
  job_card_id      uuid NOT NULL,
  worker_id        uuid NOT NULL,            -- beneficiary (individual within household)
  attendance_date  date NOT NULL,
  days_worked      numeric(3,1) NOT NULL DEFAULT 0,
  wage_rate_minor  bigint NOT NULL,
  wage_payable_minor bigint NOT NULL,
  payment_status   varchar(16) NOT NULL DEFAULT 'pending',
  payment_ref      text,                     -- FTO/PFMS reference
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);
```

**Statutory constraint:** MGNREGS wages must be disbursed within 15 days of completion of work (Section 3(3)). The platform must emit a SLA-breach event if `paid_at - attendance_date > 15 days`.

### 4.5 GP Development Plan / Block Plan [ABSENT — P2]

The GPDP (Gram Panchayat Development Plan) is mandatory under the 73rd Amendment and 15th Finance Commission. Block plan aggregates GPDP across all GPs. No planning module exists.

```sql
-- [PROPOSED] rd.gp_plans
CREATE TABLE rd.gp_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  gp_unit_id       uuid NOT NULL,
  financial_year   char(7) NOT NULL,         -- '2025-26'
  plan_type        varchar(16) NOT NULL,     -- gpdp|block|district
  status           varchar(16) NOT NULL DEFAULT 'draft',
  gram_sabha_date  date,
  approved_by      uuid,
  total_outlay_minor bigint NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);

-- [PROPOSED] rd.gp_plan_schemes
CREATE TABLE rd.gp_plan_schemes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  plan_id          uuid NOT NULL,
  scheme_id        uuid NOT NULL,            -- project.project_schemes.id
  priority         int NOT NULL DEFAULT 1,
  proposed_outlay_minor bigint NOT NULL DEFAULT 0,
  approved_outlay_minor bigint,
  convergence_with text[] DEFAULT '{}',       -- other scheme codes to converge funds
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);
```

---

## 5. Recommended Service Boundary

```
RD vertical — recommended module placement:

project-service (EXTEND — DO NOT FORK)
  ├── geo module: add stage/device_timestamp/photo_hash columns     [P1 extension]
  └── scheme module: add scheme_type (CSS/state/mgnrega) column     [P1 extension]

grant-service (EXTEND — DO NOT FORK)
  ├── beneficiary module: add geography_unit_id FK, household_id    [P0 extension]
  ├── beneficiary module: add scheme_type-aware DBT flow            [P1 extension]
  └── utilisation module: add PFMS UC export adapter               [P1 extension]

NEW rd-service  (create as a dedicated Fastify service, DB: civitas_rd)
  ├── technical-sanction module    (rd.technical_sanctions, rd.administrative_approvals, rd.work_orders)
  ├── social-audit module          (rd.social_audits, rd.social_audit_findings)
  ├── job-card module              (rd.job_cards, rd.muster_rolls, rd.muster_roll_entries)
  ├── gp-plan module              (rd.gp_plans, rd.gp_plan_schemes)
  └── inspection module           (rd.rd_inspections, rd.inspection_findings)

packages/gov-adapters (NEW package)
  ├── pfms/client.ts              — PFMS fund release + UC submission
  ├── nic-schemes/client.ts       — NIC scheme master pull
  └── disha/client.ts             — DISHA monitoring portal sync
```

**Rule:** `rd-service` may reference project-service and grant-service only via opaque IDs, never via DB join. Cross-service reads go through HTTP API (architecture rule §13).

---

## 6. Beneficiary Extension — Required Schema Changes

The `grant_beneficiaries` table today (grant-service) must be extended for rural development:

```sql
-- [PROPOSED] Extension migrations to grant-service
ALTER TABLE beneficiary.grant_beneficiaries
  ADD COLUMN geography_unit_id  uuid,         -- FK opaque ref to location.administrative_units (GP/ward)
  ADD COLUMN household_id       uuid,         -- self-reference: head of household
  ADD COLUMN caste_category     varchar(8),   -- SC|ST|OBC|GEN
  ADD COLUMN bpl_card_no        text,         -- BPL card number (masked after linkage)
  ADD COLUMN disability_pct     int,          -- % disability (for disability-targeted schemes)
  ADD COLUMN scheme_type        varchar(16);  -- individual|household|group|shg
```

`geography_unit_id` is the critical fix — it links a beneficiary to a GP or ward, enabling GP-wise beneficiary lists and preventing cross-GP data leakage once RLS is extended to also filter on GP unit.

---

## 7. State + Ministry Scheme Integration

| External system | Purpose | Integration approach | Priority |
|---|---|---|---|
| PFMS (Public Financial Management System) | Fund release tracking, UC submission | `packages/gov-adapters/src/pfms/client.ts` — POST UC, GET fund status | P1 |
| NIC Scheme Master | Scheme code, ministry mapping, funding pattern | Pull on scheme creation; cache in `project_schemes.sanctionRef` | P2 |
| DISHA (District Development Coordination and Monitoring Committee) | Scheme progress reporting to MP | Read-only push to DISHA API | P2 |
| MoRD/NREGASoft | MGNREGA job card, muster roll validation | Bi-directional sync (job card creation → NREGASoft; wage from NREGASoft DBT status) | P1 |
| AwaasSoft (PMAY-G) | PMAY Gramin beneficiary list | Read beneficiary list from AwaasSoft; write progress back | P2 |
| JJM NWM Portal (Jal Jeevan Mission) | Water connection completion tracking | Read village-wise targets; write completion data | P2 |
| DigiLocker | Beneficiary document verification | `packages/gov-adapters/src/digilocker/client.ts` | P2 |

---

## 8. Priority-Ordered Gap Register

| ID | Gap | Priority | Service | Implementation |
|---|---|---|---|---|
| RD-01 | `block` and `gp` unit types not in location-service DB | **P0** | location-service | D05 prerequisite: run location-service migration with block/gp/ward unit types |
| RD-02 | BDO office entity absent (no office registry) | **P0** | location-service | D05 offices DDL; BDO office seed for each block |
| RD-03 | `grant_beneficiaries.geography_unit_id` is free-text `geography` column | **P0** | grant-service | `ALTER TABLE beneficiary.grant_beneficiaries ADD COLUMN geography_unit_id uuid` (extension migration) |
| RD-04 | No `household_id` / family grouping in beneficiary | **P0** | grant-service | `ADD COLUMN household_id uuid` + migration |
| RD-05 | No technical sanction / administrative approval / work order entities | **P0** | new rd-service | `rd.technical_sanctions`, `rd.administrative_approvals`, `rd.work_orders` DDL + 7-file CQRS module each |
| RD-06 | `project_schemes` has no `scheme_type` (CSS/state/MGNREGA/LAP) | **P1** | project-service | `ALTER TABLE scheme.project_schemes ADD COLUMN scheme_type varchar(32)` |
| RD-07 | `project_geo_tags` missing tamper-detection fields | **P1** | project-service | Add `stage`, `device_timestamp`, `gps_accuracy_m`, `photo_hash`, `upload_method` columns |
| RD-08 | No social audit module | **P1** | new rd-service | `rd.social_audits`, `rd.social_audit_findings` DDL + routes; MGNREGA §17 mandatory |
| RD-09 | No job card / muster roll (MGNREGA) | **P1** | new rd-service | `rd.job_cards`, `rd.muster_rolls`, `rd.muster_roll_entries` DDL; SLA event (>15 days wage delay) |
| RD-10 | MGNREGA wage DBT via grant-service disbursement | **P1** | grant-service + rd-service | Add `mgnrega_wage` disbursement type; link to `muster_roll_entries` |
| RD-11 | Contractor RA bill / measurement book absent | **P1** | rd-service or procurement-service | `rd.running_account_bills`, `rd.measurement_book_entries` DDL |
| RD-12 | BDO/GP-level grievance routing in citizen-service | **P1** | citizen-service | SLA rule seed for `department_type = 'panchayat'` and `department_type = 'block'` |
| RD-13 | No block-level reporting context (analytics-service has no GP scope) | **P1** | analytics-service | Add GP/block dimension to fact ingestion once geography_unit_id is in place |
| RD-14 | `grant_beneficiaries.caste_category` absent (SC/ST/OBC required for scheme eligibility) | **P1** | grant-service | `ADD COLUMN caste_category varchar(8)` + migration |
| RD-15 | PFMS fund release + UC push adapter absent | **P1** | packages/gov-adapters | `packages/gov-adapters/src/pfms/client.ts` |
| RD-16 | GP Development Plan (GPDP) module absent | **P2** | new rd-service | `rd.gp_plans`, `rd.gp_plan_schemes` DDL + routes |
| RD-17 | Asset creation from completed works not auto-linked | **P2** | asset-service | Add event consumer: on `rd.work.completed` → create asset register entry |
| RD-18 | Rural livelihood / SHG monitoring | **P2** | grant-service | `ADD COLUMN scheme_type = 'shg'`; SHG group beneficiary with revolving fund tracking |
| RD-19 | DISHA / NREGASoft / AwaasSoft integration adapters | **P2** | packages/gov-adapters | Ministry portal adapters for scheme progress sync |
| RD-20 | Scheme convergence / multi-scheme umbrella plan | **P3** | rd-service | `rd.gp_plan_schemes.convergence_with` array; convergence budget tracking |
| RD-21 | JJM / PMAY-G integration | **P3** | packages/gov-adapters | JJM NWM + AwaasSoft adapters |
| RD-22 | DigiLocker beneficiary document verification | **P3** | packages/gov-adapters | DigiLocker pull-document API |

---

## 9. Event Topics for rd-service [PROPOSED]

```typescript
// [PROPOSED] rd-service/src/topics.ts
export const COMMANDS = {
  technicalSanctionCreate:   "rd.technical_sanction.create",
  technicalSanctionApprove:  "rd.technical_sanction.approve",
  adminApprovalCreate:       "rd.admin_approval.create",
  workOrderCreate:           "rd.work_order.create",
  workOrderComplete:         "rd.work_order.complete",
  socialAuditCreate:         "rd.social_audit.create",
  socialAuditFindingCreate:  "rd.social_audit_finding.create",
  jobCardCreate:             "rd.job_card.create",
  musterRollCreate:          "rd.muster_roll.create",
  musterRollClose:           "rd.muster_roll.close",         // triggers wage disbursement
  gpPlanCreate:              "rd.gp_plan.create",
  gpPlanApprove:             "rd.gp_plan.approve",
} as const;

export const EVENTS = {
  technicalSanctionApproved: "rd.technical_sanction.approved",
  workOrderCompleted:        "rd.work_order.completed",       // → asset-service: create asset
  socialAuditFindingRaised:  "rd.social_audit.finding.raised", // → citizen-service: grievance
  musterRollClosed:          "rd.muster_roll.closed",         // → grant-service: disburse wages
  wageDisbursementDelayed:   "rd.wage.sla_breach",            // → notification: MGNREGA §3(3) breach
  gpPlanApproved:            "rd.gp_plan.approved",
} as const;

export const CONSUMED_EVENTS = {
  workCompleted:    "project.milestone.completed",  // → link to work completion
  ucValidated:      "grant.uc.validated",            // → compliance closure
} as const;
```

---

## 10. Summary Scorecard

| Dimension | Status | Score |
|---|---|---|
| Scheme planning / fund release (project-service) | Configurable | 6/10 |
| Beneficiary management (grant-service) | Configurable (needs geography FK) | 5/10 |
| UC submission / validation | Configurable | 7/10 |
| Geo-tagged progress | Partial (missing tamper-detection) | 5/10 |
| Technical sanction / AA / work order | **ABSENT** | 0/10 |
| Social audit (MGNREGA §17) | **ABSENT** | 0/10 |
| Job card / muster roll / wage (MGNREGS) | **ABSENT** | 0/10 |
| Block administration / BDO office | **ABSENT** (location-service prerequisite) | 0/10 |
| GP Development Plan (GPDP) | **ABSENT** | 0/10 |
| State/Ministry scheme integration (PFMS/NREGASoft) | **ABSENT** | 0/10 |
| Rural livelihood / SHG | Partial | 3/10 |
| Grievance routing to BDO/GP | Configurable | 7/10 |

**Overall BDO/Panchayat/RD readiness: 2/10** — Generic project/grant modules cover scheme accounting; all works-execution and statutory rural-governance functions (social audit, job card, GPDP, technical sanction) are entirely absent.
