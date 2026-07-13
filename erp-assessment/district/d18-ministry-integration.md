# D18 — State↔Ministry Integration Assessment

**Lane:** L07 · **Date:** 2026-07-13  
**Reviewer role:** Enterprise Integration Architect + Government Finance/Scheme Domain Expert  
**Source branch:** `court-management-service` · repo at `/tmp/cms-wt`

---

## §1 — Executive Summary

| Area | Verdict | Gap Severity |
|---|---|---|
| Scheme/Ministry configurable entity model | MISSING — `ministry` is an optional string field, not an entity | P0 |
| Grant-service scheme coverage | PARTIAL — scheme/UC/disbursement exist; ministry linkage, target allocation, beneficiary aggregates absent | P1 |
| Project-service scheme coverage | PARTIAL — scheme type (`css/state/central`), fund releases, PFMS ref exist; ministry/reporting authority absent | P1 |
| Guideline distribution | ABSENT — no `scheme.guideline.issued.v1` event or document distribution flow | P1 |
| Fund release chain (PFMS→district) | PARTIAL — `project_fund_releases.pfmsRef` field exists; no PFMS adapter, no GOO/sanction order flow | P0 |
| Target allocation (district/block-wise) | ABSENT — no target model in either service | P1 |
| Progress reporting (state→ministry) | ABSENT — project physical/financial progress recorded but no upstream push | P1 |
| Utilisation certificate chain | PARTIAL — `grant_uc_statements` + `project.uc.submitted` event; no ministry submission adapter | P1 |
| Beneficiary aggregates | ABSENT — grant-service has beneficiary records per tenant; no cross-district aggregation | P2 |
| Audit observation / compliance response | PARTIAL — `grant_audit_paras` table exists; no cross-level escalation | P2 |

---

## §2 — Current Model Verification

### 2.1 Ministry as a Field, Not an Entity

[VERIFIED: `packages/types/src/index.ts:883`]
```typescript
ministry?: string;   // optional free-text — no FK, no validation, no entity
```
[VERIFIED: `packages/schemas/src/web.ts:843`]
```typescript
ministry: z.string().optional()   // zod: any string or absent
```

**Consequence:** Two tenants registering the same ministry scheme will use different strings ("Ministry of Rural Development" vs "MoRD" vs "MORD"). There is no canonical ministry registry, no scheme-to-ministry mapping as a relational entity, and no way to aggregate data across districts reporting to the same ministry.

### 2.2 Grant-Service Scheme Schema

[VERIFIED: `services/grant-service/src/modules/scheme/schema.ts`]

| Column | Present | Required for Ministry Federation |
|---|---|---|
| `code`, `name` | ✅ | ✅ |
| `sanctionRef` (opaque string) | ✅ | ✅ (source-of-record link) |
| `budgetMinor`, `disbursedMinor` | ✅ | ✅ |
| `reportingFrequencyDays` (90/180/365) | ✅ | ✅ partial |
| `openAt`, `closeAt` | ✅ | ✅ |
| `ministryId` | ❌ ABSENT | P0 required |
| `fundingAuthorityId` | ❌ ABSENT | P0 required |
| `monitoringAuthorityId` | ❌ ABSENT | P1 required |
| `parentSchemeId` (for sub-schemes/components) | ❌ ABSENT | P1 required |
| `govLevel` (central/state/district) | ❌ ABSENT | P0 required |
| `schemeOwnerDepartmentRef` | ❌ ABSENT | P1 required |
| `targetGeography` (state/district/block scope) | ❌ ABSENT | P1 required |
| `fundingPattern` (60:40, 75:25, 100:0) | ❌ ABSENT | P1 required |
| `dataShareAgreementRef` | ❌ ABSENT | P2 required |

### 2.3 Project-Service Scheme Schema

[VERIFIED: `services/project-service/src/modules/scheme/schema.ts`]

| Column | Present | Notes |
|---|---|---|
| `type` (css/state/central) | ✅ | Categorises scheme level |
| `fundingPattern` (text "100", "60:40") | ✅ | Free text — no validation |
| `totalOutlayMinor`, `releasedMinor`, `utilisedMinor` | ✅ | Financial tracking |
| `sanctionRef` | ✅ | Opaque link |
| `pfmsRef` (in `project_fund_releases`) | ✅ | PFMS reference exists |
| `ministryId` / `schemeOwner` | ❌ ABSENT | No entity linkage |
| `reportingAuthority` | ❌ ABSENT | |
| `fundingAuthority` | ❌ ABSENT | |
| `targetAllocation` (district/block breakdown) | ❌ ABSENT | |
| `beneficiaryAggregates` | ❌ ABSENT | |

### 2.4 Event Topics for Ministry Flows

[VERIFIED: `services/grant-service/src/topics.ts`, `services/project-service/src/topics.ts`]

**Exists:**
- `grant.uc.submitted` → UC submission event
- `grant.disbursement.completed` → disbursement done
- `grant.scheme.created` → scheme registered
- `project.uc.submitted` → UC from project side
- `project.fund_release.disbursed` → fund released
- `project.physical_progress.recorded` → physical progress

**Missing (all [PROPOSED]):**
- `scheme.guideline.issued.v1` — ministry→state→district guideline push
- `scheme.target.allocated.v1` — target set for district/block
- `scheme.fund.released.v1` (ministry→state→district GOO)
- `scheme.progress_report.submitted.v1` — district→state→ministry
- `scheme.uc.validated.v1` — ministry validation of UC
- `scheme.audit_observation.raised.v1` — audit para from ministry/CAG
- `scheme.compliance_response.submitted.v1`
- `scheme.beneficiary.aggregated.v1`
- `scheme.output_indicator.reported.v1`
- `scheme.outcome_indicator.reported.v1`

---

## §3 — Config-Driven Data Model for Ministry/Scheme Federation

**Principle:** No ministry name, department code, or government level is hardcoded. All are configurable entities in a `scheme-registry` module (proposed: extends grant-service or new `scheme-service`).

### 3.1 Configurable Entity Schema [PROPOSED]

```sql
-- scheme-registry module (in grant-service or new scheme-service)
-- schema: scheme_registry

-- Government level (configurable, no enum)
CREATE TABLE scheme_registry.gov_levels (
  code          VARCHAR(24) PRIMARY KEY,   -- 'central','state','district','block'
  label         TEXT NOT NULL,
  parent_code   VARCHAR(24) REFERENCES scheme_registry.gov_levels(code),
  tenant_id     UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Configurable government authority (ministry / department / directorate)
CREATE TABLE scheme_registry.gov_authorities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  short_name      TEXT,
  gov_level_code  VARCHAR(24) NOT NULL REFERENCES scheme_registry.gov_levels(code),
  parent_id       UUID REFERENCES scheme_registry.gov_authorities(id),
  authority_type  VARCHAR(32) NOT NULL,  -- ministry|department|directorate|division|secretariat
  contact_api_url TEXT,                  -- optional: where to push reports
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1
);

-- Scheme master — configurable, no hardcoded ministry names
CREATE TABLE scheme_registry.scheme_masters (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  code                     TEXT NOT NULL UNIQUE,     -- e.g. "PMAY-U-2024"
  name                     TEXT NOT NULL,
  gov_level_code           VARCHAR(24) NOT NULL,     -- 'central'|'state'|'district'
  scheme_owner_id          UUID NOT NULL REFERENCES scheme_registry.gov_authorities(id),
  funding_authority_id     UUID NOT NULL REFERENCES scheme_registry.gov_authorities(id),
  monitoring_authority_id  UUID REFERENCES scheme_registry.gov_authorities(id),
  reporting_authority_id   UUID REFERENCES scheme_registry.gov_authorities(id),
  parent_scheme_id         UUID REFERENCES scheme_registry.scheme_masters(id),
  funding_pattern          TEXT NOT NULL DEFAULT '100',  -- '60:40'|'75:25'|'90:10'|'100'
  reporting_frequency_days INTEGER NOT NULL DEFAULT 90,
  target_geography_level   VARCHAR(24),               -- 'district'|'block'|'gp'|'village'
  start_date               DATE,
  end_date                 DATE,
  sanction_ref             TEXT,                      -- opaque link to finance sanction
  pfms_scheme_code         TEXT,                      -- PFMS registration code
  data_sharing_agreement   TEXT,                      -- DSA reference / policy note
  api_contract_version     VARCHAR(16),               -- agreed API contract version
  status                   VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               UUID NOT NULL,
  updated_by               UUID NOT NULL,
  version                  INTEGER NOT NULL DEFAULT 1
);

-- Target allocation: scheme → geography → period
CREATE TABLE scheme_registry.scheme_targets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  scheme_id       UUID NOT NULL REFERENCES scheme_registry.scheme_masters(id),
  office_id       UUID NOT NULL,   -- FK → hierarchy.offices (P0 dependency)
  period          CHAR(7) NOT NULL, -- YYYY-QNN or YYYY-MM or FY
  physical_target NUMERIC(18,4),
  physical_unit   VARCHAR(32),
  financial_target_minor BIGINT,
  currency        CHAR(3) NOT NULL DEFAULT 'INR',
  allocated_by    UUID NOT NULL,
  status          VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1
);

-- Output/outcome indicator definitions (configurable, not hardcoded)
CREATE TABLE scheme_registry.scheme_indicators (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  scheme_id     UUID NOT NULL REFERENCES scheme_registry.scheme_masters(id),
  indicator_key VARCHAR(64) NOT NULL,   -- e.g. 'houses_constructed','beneficiaries_covered'
  indicator_type VARCHAR(16) NOT NULL, -- 'output'|'outcome'|'process'
  unit          VARCHAR(32) NOT NULL,
  baseline      NUMERIC(18,4),
  target        NUMERIC(18,4),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Data sharing agreements (configurable)
CREATE TABLE scheme_registry.data_sharing_agreements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  scheme_id         UUID NOT NULL REFERENCES scheme_registry.scheme_masters(id),
  from_authority_id UUID NOT NULL REFERENCES scheme_registry.gov_authorities(id),
  to_authority_id   UUID NOT NULL REFERENCES scheme_registry.gov_authorities(id),
  permitted_fields  TEXT[] NOT NULL,     -- field whitelist — no wildcard
  classification    VARCHAR(24) NOT NULL, -- 'open'|'restricted'|'confidential'
  purpose           TEXT NOT NULL,
  valid_from        DATE NOT NULL,
  valid_to          DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.2 Gap: grant-service `grant_schemes` must FK to `scheme_registry.scheme_masters`

[PROPOSED] Add column:
```sql
ALTER TABLE scheme.grant_schemes
  ADD COLUMN scheme_master_id UUID REFERENCES scheme_registry.scheme_masters(id);
```

Same for `scheme.project_schemes`:
```sql
ALTER TABLE scheme.project_schemes
  ADD COLUMN scheme_master_id UUID REFERENCES scheme_registry.scheme_masters(id);
```

---

## §4 — Ministry Federation Flows

### 4.1 Scheme Registration

```
Ministry/State Dept creates scheme in scheme-registry
  → event scheme.scheme_master.created.v1
    → grant-service subscribes: creates grant_scheme linked to scheme_master_id
    → project-service subscribes: creates project_scheme linked to scheme_master_id
    → notification-service: notifies implementing agencies
    → workflow-service: creates scheme onboarding workflow instance
```

### 4.2 Guideline Distribution

```
Ministry uploads guideline document → document-service (S3/MinIO)
  → event scheme.guideline.issued.v1 {schemeId, documentRef, version, effectiveDate}
    → implementing district tenants subscribed by scheme_id
    → knowledge-service: indexes guideline
    → notification-service: alerts district nodal officers
```

### 4.3 Fund Release Chain (GOO → PFMS → District)

```
State Finance → POST /v1/scheme-registry/schemes/{id}/fund-releases
  → command scheme.fund_release.create
    → consumer creates project_fund_releases with pfmsRef
    → enqueue scheme.fund.released.v1 {schemeId, installment, amount, pfmsRef, toDistrictId}
      → finance-service subscribes: creates receipt voucher, posts to GL
      → grant-service: updates disbursed_minor on grant_application
      → notification-service: alerts district treasury officer
```

**Gap:** PFMS adapter does not exist. [PROPOSED] `services/pfms-adapter/` using PFMS Public API (GOV PFMS REST API v3). This is a read-only pull adapter (PFMS is system-of-record for central funds; CivitasOne must never duplicate or override PFMS data).

### 4.4 Target Allocation

```
State/Ministry → POST /v1/scheme-registry/schemes/{id}/targets
  → creates scheme_registry.scheme_targets (period, office, physical/financial)
  → event scheme.target.allocated.v1 {schemeId, officeId, period, targets}
    → project-service: updates scheme component allocations
    → analytics-service: seeds district dashboard target vs. actuals
```

### 4.5 Progress Reporting (District → State → Ministry)

```
District officer → POST /v1/project/physical-progress (existing)
  → project.physical_progress.recorded (existing event)
    → report-service aggregates by scheme_master_id + period + govLevel
    → at reporting_frequency_days: event scheme.progress_report.submitted.v1
      → state dashboard consumes
      → if ministry has api_contact_url: HTTP push to ministry portal (outbound adapter)
        → retry 3× with exponential backoff; DLQ + alert on persistent failure
```

### 4.6 Utilisation Certificate Chain

```
District → POST /v1/grant/uc  (existing, creates grant_uc_statements)
  → grant.uc.submitted (existing event)
    → finance-service validates expenditure vs. GL
    → grant.uc.validated.v1 / grant.uc.rejected.v1
      → state office receives via subscription
        → state aggregates UCs by scheme + period
          → ministry submission adapter pushes to PFMS/e-Sampada
```

**Current gap:** `grant_uc_statements.ucRef` is opaque string pointing to `finance_uc:UUID` — the finance-service UC entity. [VERIFIED: `services/grant-service/src/modules/utilisation/schema.ts:17`]. No auto-link from UC validation to upstream ministry portal.

### 4.7 Beneficiary Aggregates

```
Scheme-level target: N beneficiaries across M districts
  → each district's grant-service has beneficiary rows (tenantId scoped)
  → report-service (cross-tenant read-model) aggregates by scheme_master_id
    → event scheme.beneficiary.aggregated.v1 {schemeId, period, count, demographics}
      → analytics-service: ministry dashboard
      → external: NIC/ministry MIS portal via adapter (PROPOSED)
```

**Key constraint:** beneficiary PII (Aadhaar, bank) must NOT leave district tenant. Aggregates only (count, category breakdown). Verified: `grant_schemes` has DPDP §4 Aadhaar masking [memory: `project_grant_service_built.md`]; aggregation layer must strip PII before cross-boundary push.

### 4.8 Audit Observations and Compliance Responses

```
CAG/Internal audit raises observation
  → grant.audit_paras (existing table in grant-service: paraNo, observation, recoveryMinor)
  → event scheme.audit_observation.raised.v1 {schemeId, paraNo, amount, auditType}
    → state finance receives (for state schemes)
    → ministry receives for CSS (Central Govt audit)

District responds to para
  → event scheme.compliance_response.submitted.v1 {paraId, response, attachmentRef}
    → audit-service: records in hash chain
    → upstream notification to audit authority
```

**Gap:** `grant_audit_paras.status` has no corresponding event. [VERIFIED: `services/grant-service/src/modules/utilisation/schema.ts:47-63`] — status column exists (`open`/etc.) but no `grant.audit_para.status_changed` event in `topics.ts`. Para closure is invisible to upstream.

---

## §5 — Priority Register

| ID | Finding | Priority |
|---|---|---|
| D18-01 | `ministry` is free-text, not an entity — no canonical authority registry | P0 |
| D18-02 | `scheme_registry.scheme_masters` does not exist — no FK linkage | P0 |
| D18-03 | `scheme_registry.gov_authorities` does not exist — ministry/dept config impossible | P0 |
| D18-04 | `scheme_targets` table absent — district-wise target allocation impossible | P1 |
| D18-05 | No PFMS adapter — central fund release cannot be tracked automatically | P0 |
| D18-06 | `scheme.guideline.issued.v1` event absent — guideline distribution manual | P1 |
| D18-07 | `scheme.fund.released.v1` event absent — fund release chain broken | P0 |
| D18-08 | `grant.audit_para.status_changed` event absent — audit closure invisible | P2 |
| D18-09 | Beneficiary aggregation requires cross-tenant read-model (org model P0 dependency) | P2 |
| D18-10 | `data_sharing_agreements` table absent — field-level data sharing ungoverned | P2 |
| D18-11 | No output/outcome indicator model — scheme effectiveness unmeasurable | P2 |
| D18-12 | `scheme.progress_report.submitted.v1` event absent — upstream reporting broken | P1 |
| D18-13 | Ministry portal push adapter absent — all upstream reporting is manual | P1 |

---

*Cross-references: d09 (collectorate gaps), d17 (district↔state chains), d19 (event catalogue), d20 (integration matrix), 07-integration-matrix.md (existing event linkages)*
