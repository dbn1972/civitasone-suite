# D16 — District Federation Model

**Lane:** L08 · **Date:** 2026-07-13  
**Role:** SaaS/Multi-Tenancy Architect  
**Source branch:** `court-management-service` · repo `/tmp/cms-wt`

> **Prerequisites:** `08-tenant-isolation-report.md` (tenant isolation 7/10), `d15-security-domain-matrix.md` (domain isolation gaps), `d02-current-architecture.md` (runtime stack). This document builds directly on those; do not re-read them here.

---

## 1. Scope

Define *how* a District Governance Platform structures its multi-tenancy across the 12-level governance stack:

**Ministry → State Secretariat → DGP → Divisional Commissioner → District Collector/SP → SDM → Tehsil → Block/BDO → Police Station → ULB → Panchayat → Village**

---

## 2. Option Evaluation

### 2.1 Option A — District = One Tenant

**Model:** One `tenant_id` per district. All departments (Collectorate, Police, Revenue, Finance, Health, Education, RD, Urban) share a single tenant row.

| Risk | Severity | Evidence |
|------|----------|----------|
| Over-visibility: Finance admin can query Police staff roster via same-tenant RLS | P0 | `tenant.tenants` has one `isolationTier`; RLS only separates tenants, not domains within a tenant [VERIFIED: `08-tenant-isolation-report.md §5`] |
| Blast-radius: one compromised tenant credential exposes entire district | P0 | Single `app.tenant_id` GUC used across all 35 service DBs for one district |
| Shared admin: DM (`DISTRICT_ADMIN`) would hold admin rights over SP's HR data | P0 | No intra-tenant domain RBAC structure exists today |
| Police confidentiality: CERT-In requires dedicated infrastructure for classified data | P0 | Single shared PG cluster, Redis, S3 [VERIFIED: `d15-security-domain-matrix.md §B.1`] |
| No per-domain KMS key: `kmsKeyRef` exists on tenant row but shared across all departments | P1 | `tenant-service/src/modules/tenant/schema.ts:22` — `kmsKeyRef` is per-tenant, not per-domain |
| Cross-domain search leakage: single Meilisearch instance, shared index namespace | P1 | `packages/search` → single `MEILI_URL` [VERIFIED: `d15-security-domain-matrix.md §B.1`] |

**VERDICT: REJECTED** — fails Police confidentiality and Treasury CERT-In requirements.

---

### 2.2 Option B — Departmental Tenants Within a District Federation

**Model:** Each department is its own tenant. A "Pune Collectorate" tenant and "Pune SP Office" tenant both exist. Federation = logical grouping of sibling tenants by `orgCategory` + a shared coordination service.

| Dimension | Assessment |
|-----------|------------|
| Security isolation | ✓ Each department fully isolated by RLS + can have own `isolationTier` |
| Police/Treasury dedicated cells | ✓ Silo tier available [VERIFIED: `tenant-router.ts:envTenantResolver`] |
| Cross-department coordination | **GAP:** DM order to Police = cross-tenant API call today; no federated query |
| HRMS deputation/transfer | **GAP:** Deputation spanning Collectorate → Police is cross-tenant; `hrms_departments.borrowingDepartmentId` is intra-tenant [VERIFIED: `hrms-service/src/modules/deputation/schema.ts:28`] |
| Scale: 640 districts × 10 depts = 6,400 pool tenants | Manageable; pool tier handles this |
| Admin complexity | High: provisioning, configuration, and module-enable per tenant × 6,400 |
| Shared services (notification, workflow) | Must accept cross-tenant calls or be replicated per tenant |

**VERDICT: PARTIALLY VIABLE** — correct for security isolation but needs a coordination layer and a federation API to avoid cross-tenant spaghetti for DM→SP coordination, disaster management, election duty, etc.

---

### 2.3 Option C — State Tenant with District Partitions

**Model:** One tenant per state. Districts are `jurisdictionId` partitions, not tenants.

| Risk | Severity |
|------|----------|
| Defeats federation: district-A admin can see district-B data via same `tenant_id` RLS | P0 |
| No per-district customisation: module config, edition, KMS key all shared statewide | P0 |
| Blast-radius = entire state on one credential | P0 |
| No statutory basis: districts are administrative units, not sub-orgs of one legal entity | P0 |

**VERDICT: REJECTED** — structurally wrong for a federated platform.

---

### 2.4 Option D — Hybrid Federated (RECOMMENDED)

**Model:** Layered multi-tenancy combining a shared state control-plane, per-district-per-department tenants in shared cells for standard domains, and dedicated silo cells for sensitive domains (Police, Treasury).

```
National/Ministry Integration Cell  (one, cloud)
  └── State Control Plane Cell       (one per state)
        ├── Shared District Cell     (one per ~100 districts, pool-tier tenants)
        │     └── District Federation: 8–12 pool tenants per district
        │           (Collectorate · Revenue · Health · Education · RD · Urban · Coordination)
        ├── Police Dedicated Cell    (one per state, silo-tier)
        │     └── Police tenant per district in dedicated infra
        └── Treasury Dedicated Cell  (one per state, silo-tier)
              └── Finance/Treasury tenant per district in dedicated infra
```

**Why D is correct:**

1. **Security:** Police and Treasury get dedicated PG cluster, Redis, S3, KMS per D15's requirements [VERIFIED gap: `d15-security-domain-matrix.md §B.1`].
2. **Economics:** 8 out of 10 departments (Collectorate, Revenue, Health, etc.) share infrastructure at pool tier — cost-effective for small districts.
3. **Coordination:** A shared coordination service (read-only projection) spans domains without sharing raw data — minimum-necessary fields only.
4. **Primitives reuse:** All three tiers map to the EXISTING `TenantRouter` pool|silo primitives [VERIFIED: `packages/db/src/tenant-router.ts`].
5. **Incremental adoption:** Districts start in the shared cell (pool), migrate Police/Treasury to silo cells as they grow.

---

## 3. Mapping Option D to Existing Primitives

| D Component | Existing Primitive | Gap |
|---|---|---|
| Pool-tier district dept tenants | `isolationTier: 'pool'` in `tenant.tenants` [VERIFIED: `tenant-service/src/modules/tenant/schema.ts:18`] | ✓ Available today |
| Silo-tier Police/Treasury tenants | `isolationTier: 'silo'`, `dbDsnRef` (secret-manager ref), `kmsKeyRef` [VERIFIED: same file:18-22] | Tenant-router NOT wired to services; all services use module-level `DATABASE_URL` singleton [VERIFIED: `d02-current-architecture.md §2`] |
| Silo DB provisioning | `install.silo_provisions` schema + `provision-silo-tenant.mjs` + `install.silo_provision.update` topic [VERIFIED: `install-service/src/modules/provisioning/schema.ts`, `install-service/src/topics.ts`] | Provisions into empty DB only — no data copy pipeline for migration from pool → silo |
| Per-tenant module catalogue | `admin.config.admin_module_configs` (`moduleKey`, `enabled`) [VERIFIED: `admin-service/src/modules/config/schema.ts:16-27`] | Module-guard built but UNWIRED [VERIFIED: `gateway-service/src/module-guard.ts:12-14` — TODO comment] |
| Per-tenant KMS key | `kmsKeyRef` column exists; `encryptedText()` PII wrapper uses env var key per service | ALL live tenants have `kms_key_ref = NULL` [VERIFIED: `d15-security-domain-matrix.md §B.1`]; no per-tenant key derivation in `pii-crypto.ts` |
| Cell placement/registry | **ABSENT** | No cell registry table, no placement engine, no tenant→cell mapping — P0 platform build |
| Tier migration (pool→silo) | **ABSENT** | No data-movement pipeline; `install.wizard` handles fresh installs only |
| Administrative unit hierarchy | `hierarchy.administrative_units` (state/district/block/gp/ward/zone + `lgdCode`) [VERIFIED: `location-service/src/modules/hierarchy/schema.ts`] | ✓ LGD codes present; geography foundation exists |
| Jurisdiction assignment | `jurisdiction.jurisdictions` (`officeId → unitId`, `level`, `isPrimary`) [VERIFIED: `location-service/src/modules/jurisdiction/schema.ts`] | `officeId` references a concept NOT backed by any table — no StatutoryOffice registry |
| Federated identity | Keycloak OIDC; JWT `tid` claim = tenantId [VERIFIED: `08-tenant-isolation-report.md §How tenant context is established`] | Keycloak has one realm `civitasone`; no per-cell realm federation; no cross-tenant SAML IdP federation |

---

## 4. Target Federation Structure (Implementable)

### 4.1 What Is a "Tenant" in This Model

> **RECOMMENDED TENANT GRANULARITY: One tenant = one department within one district.**

Rationale:
- A `tenant_id` semantically encodes `(state, district, department)`.
- In practice: UUID, but `orgCategory` + `settings.lgdDistrictCode` + `settings.departmentCode` are the human-readable keys.
- Example instantiation for Pune district:
  - `PUNE-COLLECTORATE` → `isolationTier: 'pool'`, shared cell
  - `PUNE-POLICE` → `isolationTier: 'silo'`, Police dedicated cell
  - `PUNE-TREASURY` → `isolationTier: 'silo'`, Treasury dedicated cell
  - `PUNE-HEALTH` → `isolationTier: 'pool'`, shared cell
  - `PUNE-EDUCATION` → `isolationTier: 'pool'`, shared cell
  - `PUNE-REVENUE` → `isolationTier: 'pool'`, shared cell
  - `PUNE-RD` → `isolationTier: 'pool'`, shared cell
  - `PUNE-URBAN` → `isolationTier: 'pool'`, shared cell
  - `PUNE-COORDINATION` → `isolationTier: 'pool'`, shared cell (read-model, no raw PII)

### 4.2 How RLS + IsolationTier Realise It

```
Gateway JWT edge  → tid (tenantId) from RS256 JWT
  │  x-tenant-id header → all upstream services
  │  x-domain-id header → domain-level routing (NEW PRIMITIVE NEEDED)
  │
  ▼
Service request handler
  │  runWithTenant(tenantId) → sets app.tenant_id GUC
  │  RLS policy: tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid
  │
  ├─ Pool tenant: router.sqlFor(tenantId) → shared pool client (existing behaviour)
  └─ Silo tenant: router.sqlFor(tenantId) → dedicated DB client via dbDsnRef
                  (kmsKeyRef → Vault/KMS → per-tenant encryption key)
```

### 4.3 State Control Plane

Hosted in **State Control Plane Cell** (one per state). Authoritative registries:

| Registry | Service | Schema | Purpose |
|---|---|---|---|
| Tenant/Org Registry | tenant-service | `tenant.tenants` + `tenant.tenant_quotas` | Source of truth for all district tenants in state |
| **Cell Registry** [NEW] | install-service | `install.cells` [NEW TABLE] | Maps tenant → cell (pool/silo) + cell DSN, Redis URL, S3 bucket |
| **Office Registry** [NEW] | location-service | `location.offices` [NEW TABLE] | StatutoryOffice: `officeId`, `districtCode`, `departmentCode`, `type`, `jurisdictions` |
| Admin Geography Registry | location-service | `hierarchy.administrative_units` + `jurisdiction.jurisdictions` | LGD codes, district/block/GP hierarchy |
| Identity Federation | Keycloak | realms + identity federation | Per-cell Keycloak realm federated to state Keycloak via SAML IdP |
| Policy Registry | policy-service | `policy.*` | RBAC/ABAC roles + bindings (cross-district role templates) |
| Config Registry | admin-service | `config.admin_module_configs` | Per-tenant module enable/disable |
| Module Catalogue | admin-service | `config.admin_editions` | Edition → module set mapping |
| Integration Catalogue | [NEW metadata-service] | [NEW] | External system adapters available per domain |
| Audit Policy | audit-service | `audit.*` | Cross-district audit retention and classification |
| Data Classification Policy | [NEW policy-service extension] | [NEW] | Per-domain data class (`PUBLIC`/`INTERNAL`/`RESTRICTED`/`CONFIDENTIAL`/`SECRET`) |
| Dashboard Metadata | analytics-service | `facts.*` | State-level aggregation definitions |

### 4.4 District Federation

Per district, the following tenants are created:

| Domain | Tier | Cell | RLS? | KMS Key | `orgCategory` Value |
|---|---|---|---|---|---|
| Collectorate (DM + subordinate) | pool | Shared District Cell | ✓ | Shared tenant key | `district_collectorate` |
| Police (SP + stations) | silo | Police Dedicated Cell | ✓ | Per-silo CMK | `district_police` |
| Treasury / Finance (DDO + PAO) | silo | Treasury Dedicated Cell | ✓ | Per-silo CMK | `district_treasury` |
| Health (CMO + PHCs) | pool | Shared District Cell | ✓ | Shared tenant key | `district_health` |
| Education (DEO + schools) | pool | Shared District Cell | ✓ | Shared tenant key | `district_education` |
| Revenue / Land (DRO + tehsils) | pool | Shared District Cell | ✓ | Shared tenant key | `district_revenue` |
| Rural Development (BDO + GPs) | pool | Shared District Cell | ✓ | Shared tenant key | `district_rural_dev` |
| Urban (ULB / Municipality) | pool | Shared District Cell | ✓ | Shared tenant key | `district_urban` |
| Shared Coordination (cross-domain) | pool | Shared District Cell | ✓ (read-model) | Shared tenant key | `district_coordination` |

**Shared Coordination Domain:** A read-model tenant populated by events from all domain tenants. Stores only minimum-necessary coordination facts (disaster event ID, law-and-order alert, election duty schedule, VIP movement — **no PII, no operational data**). analytics-service and workflow-service project into this domain. DM can query district-level coordination state without accessing Police or Finance raw data.

### 4.5 Subordinate Offices Below District

| Level | Model | Tenant |
|---|---|---|
| SDM (Sub-Divisional Magistrate) | `officeType: 'SDM'` in Office Registry; jurisdictionId = sub-division admin unit | Same tenant as `district_collectorate` (subdivision is not a separate department) |
| Tehsil / Taluka | `officeType: 'tehsil'` in Office Registry | Same tenant as `district_revenue`; `jurisdictionId` scopes data |
| Block / BDO | `officeType: 'block'` in Office Registry | Same tenant as `district_rural_dev` |
| Police Station | `officeType: 'police_station'` in Office Registry | Same tenant as `district_police` (silo) |
| ULB Ward Office | `officeType: 'ward'` in Office Registry | Same tenant as `district_urban` |
| Panchayat | `officeType: 'gp'` in Office Registry | Same tenant as `district_rural_dev` |
| Village | Not a tenant; `lgdVillageCode` attribute on records | Filtered by `location_id` field on domain entities |

---

## 5. Concrete Schema DDL for New Primitives

### 5.1 Cell Registry (install-service)

```sql
-- install schema (existing: install-service/src/modules/provisioning/schema.ts)
CREATE TABLE install.cells (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,                                 -- always = control-plane tenant
  cell_name     VARCHAR(64) NOT NULL UNIQUE,                   -- e.g. 'maha-shared-1', 'maha-police'
  cell_type     VARCHAR(32) NOT NULL,                          -- 'shared_district' | 'police' | 'treasury' | 'control_plane' | 'ministry'
  region        VARCHAR(64) NOT NULL,                          -- 'ap-south-1', 'ap-south-2'
  state_code    VARCHAR(4) NOT NULL,                           -- 'MH', 'UP', 'TN'
  db_dsn_ref    TEXT NOT NULL,                                 -- Vault path to PG cluster DSN
  redis_url_ref TEXT NOT NULL,                                 -- Vault path to Redis URL
  s3_bucket_ref TEXT NOT NULL,                                 -- Vault path to S3 bucket name
  kms_key_ref   TEXT,                                          -- Vault path to cell-level CMK (silo cells)
  max_tenants   INTEGER NOT NULL DEFAULT 1200,
  max_users     INTEGER NOT NULL DEFAULT 120000,
  status        VARCHAR(24) NOT NULL DEFAULT 'active',         -- 'provisioning' | 'active' | 'draining' | 'decommissioned'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID NOT NULL,
  updated_by    UUID NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1
);

-- Tenant → Cell placement
CREATE TABLE install.tenant_cell_placements (
  tenant_id     UUID PRIMARY KEY,
  cell_id       UUID NOT NULL REFERENCES install.cells(id),
  placed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  migrated_from UUID,                                          -- prior cell_id if migrated
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID NOT NULL,
  updated_by    UUID NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1
);
```

### 5.2 Office Registry (location-service)

```sql
-- New table in location schema (location-service/src/modules/locations/schema.ts)
CREATE TABLE location.offices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  office_code         VARCHAR(64) NOT NULL,                     -- e.g. 'MH-PUNE-COLLECTORATE'
  office_name         VARCHAR(200) NOT NULL,
  office_type         VARCHAR(32) NOT NULL,                     -- 'collectorate' | 'sdm' | 'tehsil' | 'block' | 'police_station' | 'ulb' | 'gp'
  department_code     VARCHAR(32) NOT NULL,                     -- 'REVENUE' | 'POLICE' | 'HEALTH' | etc.
  admin_unit_id       UUID NOT NULL,                            -- FK → hierarchy.administrative_units.id
  parent_office_id    UUID,                                     -- hierarchical nesting
  lgd_code            VARCHAR(32),                              -- LGD local body code
  head_position_id    UUID,                                     -- FK → location.positions.id (NEW)
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID NOT NULL,
  updated_by          UUID NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1
);
```

### 5.3 Tenant Table Extension (migration)

```sql
-- Add federation fields to tenant-service/src/modules/tenant/schema.ts
ALTER TABLE tenant.tenants
  ADD COLUMN lgd_state_code    VARCHAR(4),     -- '27' (Maharashtra)
  ADD COLUMN lgd_district_code VARCHAR(8),     -- '527' (Pune)
  ADD COLUMN department_code   VARCHAR(32),    -- 'REVENUE' | 'POLICE' | 'HEALTH'
  ADD COLUMN parent_tenant_id  UUID,           -- control-plane tenant (state level)
  ADD COLUMN cell_id           UUID;           -- populated by install-service after placement
-- NOTE: cell_id here is denormalised from install.tenant_cell_placements for fast lookup
```

---

## 6. Priority Map

| Gap | Priority | Owner Service |
|---|---|---|
| Cell registry (`install.cells` + `install.tenant_cell_placements`) | **P0** | install-service |
| Office registry (`location.offices`) | **P0** | location-service |
| Wire tenant-router into all services (replace module-level singleton) | **P0** | packages/db + all services |
| Wire module-guard in gateway (`app.ts` TODO) | **P0** | gateway-service |
| Tenant table federation columns (`lgd_state_code`, `lgd_district_code`, `department_code`, `parent_tenant_id`, `cell_id`) | **P0** | tenant-service |
| Keycloak per-cell realm + state IdP federation | **P1** | infra/onprem Keycloak helm |
| KMS per-domain CMK wiring (`kmsKeyRef` → pii-crypto key derivation) | **P1** | packages/db + all PII-using services |
| Silo cell provisioning (Police/Treasury) — actual dedicated PG cluster + Redis + S3 | **P1** | infra/aws + install-service |
| Pool→silo data-migration pipeline | **P1** | install-service (new wizard stage) |
| Coordination read-model service (cross-domain projection) | **P2** | analytics-service or new coordination-service |
| StatutoryOffice → Position → Posting model | **P2** | location-service + hrms-service |
| Ministry integration cell + cross-state analytics | **P3** | analytics-service federation |
