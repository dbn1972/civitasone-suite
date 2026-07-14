# D22 — Target Architecture Diagram

**Lane:** L08 · **Date:** 2026-07-13  
**Role:** SaaS/Multi-Tenancy Architect  
**Source branch:** `court-management-service` · repo `/tmp/cms-wt`

> **All service names, table names, and event topics are grounded in the actual codebase.** New components are marked `[NEW]`. Components built but not yet wired are marked `[UNWIRED]`. See `d21-target-architecture.md` for the prose description.

---

## Diagram 1 — Top-Level Federation Topology

```mermaid
flowchart TD
    subgraph National["NATIONAL / MINISTRY (L1)"]
        PFMS["PFMS\n(gov-adapters/pfms.ts ✓)"]
        CCTNS_NAT["CCTNS/ICJS\n(ABSENT — integrate, don't duplicate)"]
        DL_NAT["DigiLocker\n(ABSENT adapter)"]
        EGOV["eCourts/NJDG\n(ABSENT adapter)"]
    end

    subgraph StateInteg["STATE INTEGRATION LAYER (L2)"]
        IFMS["State IFMS/iBank\n(ABSENT adapter)"]
        EDISTRICT["eDistrict Portal\n(ABSENT adapter)"]
        LGD_API["LGD API\n(ABSENT adapter)"]
        CCTNS_ST["CCTNS State Node\n(read-only FIR status only)"]
    end

    subgraph SCP["STATE CONTROL PLANE CELL (L3) — one per state"]
        KC_STATE["Keycloak\nstate realm (IdP)"]
        TENANT_SVC["tenant-service\ntenants + quotas\nisolationTier / dbDsnRef / kmsKeyRef [VERIFIED]"]
        INSTALL_SVC["install-service\ncell-registry [NEW]\nsilo_provisions [VERIFIED]"]
        ADMIN_SVC["admin-service\nmodule_configs\nfeature_flags [VERIFIED]"]
        POLICY_SVC["policy-service\nRBAC/ABAC eval"]
        AUDIT_SVC["audit-service\nCAG para state machine"]
        LOC_SVC["location-service\nadmin_units (LGD) [VERIFIED]\njurisdictions [VERIFIED]\noffices [NEW]"]
        ANALYTICS_STATE["analytics-service\nstate aggregation"]
        GW_STATE["gateway-service\nJWT edge + module-guard [UNWIRED]\nquota-check [WIRED]"]
    end

    subgraph SharedDistCell["SHARED DISTRICT CELL (one per ~100 districts)"]
        direction TB
        GW_SD["gateway-service\n(pool-tier tenants)"]
        subgraph PoolServices["All 37 services (pool-tier)"]
            POOL_HRMS["hrms-service"]
            POOL_FIN["finance-service"]
            POOL_WF["workflow-service"]
            POOL_CITIZEN["citizen-service"]
            POOL_NOTIF["notification-service"]
            POOL_OTHER["…34 other services"]
        end
        PG_SHARED["PostgreSQL 16\n(shared cluster)\n35 civitas_* DBs + RLS\n(pool-tier tenants)"]
        REDIS_SHARED["Redis 7\n(shared)\nkey: {svc}:{tenant}:{res}:{id}"]
        S3_SHARED["S3/MinIO\nbucket: civitasone-shared"]
    end

    subgraph PoliceCell["POLICE DEDICATED CELL (one per state)"]
        direction TB
        GW_POL["gateway-service\n(silo-tier, police only)"]
        POL_HRMS["hrms-service\n(police establishment)"]
        POL_PAY["payroll-service\n(police pay)"]
        POL_COURT["court-service\n(civil court mgmt)\n20 modules [VERIFIED]"]
        POL_WF["workflow-service"]
        POL_NOTIF["notification-service"]
        PG_POL["PostgreSQL 16\n(dedicated cluster)\ncivitas_police_* DBs\nCERT-In compliant"]
        REDIS_POL["Redis 7\n(dedicated)\nno civilian key mixing"]
        S3_POL["S3 bucket: civitasone-police\nDenyAllExcept[police_svc]"]
    end

    subgraph TreasuryCell["TREASURY DEDICATED CELL (one per state)"]
        direction TB
        GW_TR["gateway-service\n(silo-tier, treasury only)"]
        TR_FIN["finance-service\nbudget/gl/treasury/payments"]
        TR_PROC["procurement-service"]
        TR_PAY["payroll-service\n(govt salary)"]
        TR_AUD["audit-service\nCAG trail"]
        PG_TR["PostgreSQL 16\n(dedicated cluster)\ncivitas_finance_* DBs\n7-year WAL retention"]
        REDIS_TR["Redis 7\n(dedicated)"]
        S3_TR["S3 bucket: civitasone-finance\nCAG export path"]
    end

    subgraph MiniCell["MINISTRY INTEGRATION CELL (L1 — cloud, one national)"]
        GW_MIN["gateway-service\n(ministry-facing)"]
        ANALYTICS_MIN["analytics-service\nnational aggregation"]
        AUDIT_MIN["audit-service\nnational compliance"]
    end

    National -->|HTTPS mTLS| StateInteg
    StateInteg -->|API + events| SCP
    SCP -->|cell DNS + Keycloak realm federation| SharedDistCell
    SCP -->|cell DNS + Keycloak realm federation| PoliceCell
    SCP -->|cell DNS + Keycloak realm federation| TreasuryCell
    SCP -->|event fan-out [P3]| MiniCell

    GW_SD --> PoolServices
    PoolServices --> PG_SHARED
    PoolServices --> REDIS_SHARED
    PoolServices --> S3_SHARED

    GW_POL --> POL_HRMS
    GW_POL --> POL_PAY
    GW_POL --> POL_COURT
    GW_POL --> POL_WF
    GW_POL --> POL_NOTIF
    POL_HRMS & POL_PAY & POL_COURT & POL_WF & POL_NOTIF --> PG_POL
    POL_HRMS & POL_PAY & POL_COURT --> REDIS_POL
    POL_COURT --> S3_POL

    GW_TR --> TR_FIN
    GW_TR --> TR_PROC
    GW_TR --> TR_PAY
    GW_TR --> TR_AUD
    TR_FIN & TR_PROC & TR_PAY & TR_AUD --> PG_TR
    TR_FIN & TR_PROC --> REDIS_TR
    TR_FIN --> S3_TR

    style National fill:#f5f5f5,stroke:#999
    style StateInteg fill:#e8f4f8,stroke:#666
    style SCP fill:#d4edda,stroke:#28a745
    style SharedDistCell fill:#fff3cd,stroke:#ffc107
    style PoliceCell fill:#f8d7da,stroke:#dc3545
    style TreasuryCell fill:#d1ecf1,stroke:#17a2b8
    style MiniCell fill:#e2d9f3,stroke:#6f42c1
```

---

## Diagram 2 — District Federation: Per-District Tenant Layout

```mermaid
flowchart LR
    subgraph District["DISTRICT (e.g. Pune)"]
        subgraph SharedCell["Shared District Cell (pool-tier)"]
            T1["tenant: PUNE-COLLECTORATE\norgCategory: district_collectorate\nisolationTier: pool\n→ workflow, citizen, legal, hrms, notification"]
            T2["tenant: PUNE-REVENUE\norgCategory: district_revenue\nisolationTier: pool\n→ finance(DDO), hrms, workflow"]
            T3["tenant: PUNE-HEALTH\norgCategory: district_health\nisolationTier: pool\n→ hrms, procurement, grant, citizen"]
            T4["tenant: PUNE-EDUCATION\norgCategory: district_education\nisolationTier: pool\n→ hrms, grant, citizen"]
            T5["tenant: PUNE-RURAL-DEV\norgCategory: district_rural_dev\nisolationTier: pool\n→ grant, project, finance, hrms"]
            T6["tenant: PUNE-URBAN\norgCategory: district_urban\nisolationTier: pool\n→ finance (prop tax), citizen, workflow"]
            T7["tenant: PUNE-COORDINATION\norgCategory: district_coordination\nisolationTier: pool\n→ analytics [read-model, no PII]\n→ workflow [multi-dept]\n→ notification [broadcast]"]
        end
        subgraph PoliceCell["Police Dedicated Cell (silo)"]
            T8["tenant: PUNE-POLICE\norgCategory: district_police\nisolationTier: silo\ndbDsnRef: vault://police-cell/pg-dsn\nkmsKeyRef: vault://police-cell/cmk\n→ hrms, payroll, court, workflow"]
        end
        subgraph TreasuryCell["Treasury Dedicated Cell (silo)"]
            T9["tenant: PUNE-TREASURY\norgCategory: district_treasury\nisolationTier: silo\ndbDsnRef: vault://treasury-cell/pg-dsn\nkmsKeyRef: vault://treasury-cell/cmk\n→ finance, procurement, payroll, audit"]
        end
    end

    subgraph Offices["Office Registry (location.offices [NEW])"]
        O1["Pune Collector's Office\nofficeType: collectorate\ntenantId → PUNE-COLLECTORATE"]
        O2["Haveli SDM Office\nofficeType: sdm\nparentOffice → Pune Collector\ntenantId → PUNE-COLLECTORATE"]
        O3["Haveli Tehsil\nofficeType: tehsil\nparentOffice → Haveli SDM\ntenantId → PUNE-REVENUE"]
        O4["Mulshi Gram Panchayat\nofficeType: gp\ntenantId → PUNE-RURAL-DEV"]
        O5["Pune City Police Station\nofficeType: police_station\ntenantId → PUNE-POLICE"]
        O6["Pune Municipal Corporation\nofficeType: ulb\ntenantId → PUNE-URBAN"]
    end

    T1 --- O1
    T1 --- O2
    T2 --- O3
    T5 --- O4
    T8 --- O5
    T6 --- O6

    subgraph Coord["Coordination Read-Model"]
        COORD["PUNE-COORDINATION tenant\nReceives events from:\n- T1 (DM orders)\n- T8 (police coordination — stripped PII)\n- T3 (health alerts)\n- T5 (disaster relief)\nProjects: event_id, type, classification,\ndistrictCode, effectiveAt — NO raw PII"]
    end

    T1 -->|event: coordination.alert.issued| Coord
    T8 -->|event: coordination.police_coordination.requested\n(PII stripped by policy)| Coord
    T3 -->|event: coordination.health_alert.issued| Coord
    T5 -->|event: coordination.relief_operation.opened| Coord
```

---

## Diagram 3 — Request Flow: Tenant-Router + RLS + Cell Routing (Target)

```mermaid
sequenceDiagram
    participant Client
    participant GW as gateway-service<br/>(JWT edge + module-guard)
    participant SVC as upstream-service<br/>(e.g. hrms-service)
    participant TR as TenantRouter<br/>(packages/db/tenant-router.ts)
    participant PG as PostgreSQL<br/>(pool or silo DB)
    participant KC as Keycloak<br/>(JWKS RS256)

    Client->>GW: POST /api/v1/hrms/employees<br/>Authorization: Bearer JWT<br/>X-Office-Id: <officeUUID>
    GW->>KC: GET /.well-known/jwks.json (cached)
    KC-->>GW: RS256 public key
    GW->>GW: Verify JWT; extract tid (tenantId)<br/>Verify x-office-id belongs to tenant<br/>(policy-service cache lookup)
    GW->>GW: checkModuleEnabled(tenant, 'hrms')<br/>[CURRENTLY UNWIRED — P0 to fix]
    GW->>SVC: Forward: x-tenant-id, x-office-id,<br/>x-correlation-id, x-user-id
    SVC->>SVC: runWithTenant(tenantId)<br/>→ AsyncLocalStorage.run({tenantId})
    SVC->>TR: sqlFor(tenantId)
    TR->>TR: resolver(tenantId)<br/>→ pool: return shared client<br/>→ silo: return dedicated client (LRU cache)
    TR-->>SVC: SqlClient
    SVC->>PG: BEGIN<br/>SET LOCAL app.tenant_id = '<tenantId>'<br/>SET LOCAL app.office_id = '<officeId>' [NEW]
    PG->>PG: RLS: tenant_id = app.tenant_id ✓<br/>office filter (where applicable) ✓
    PG-->>SVC: Rows (tenant-scoped)
    SVC->>SVC: Publish to outbox (_outbox.messages)<br/>COMMIT
    SVC-->>GW: 202 Accepted { id, correlationId }
    GW-->>Client: 202 Accepted
```

---

## Diagram 4 — Event Flow: Coordination Cross-Domain (Target)

```mermaid
flowchart TD
    subgraph TreasuryCell["Treasury Dedicated Cell"]
        FIN["finance-service\n(PUNE-TREASURY tenant)"]
    end
    subgraph SharedCell["Shared District Cell"]
        WF["workflow-service\n(PUNE-COLLECTORATE tenant)"]
        COORD_SVC["coordination-service [NEW]\n(PUNE-COORDINATION tenant)"]
        NOTIF["notification-service\n(PUNE-COORDINATION tenant)"]
    end
    subgraph PoliceCell["Police Dedicated Cell"]
        POL_WF["workflow-service\n(PUNE-POLICE tenant)"]
    end

    FIN -->|event: finance.budget.alert_issued\n{eventId, districtCode, alertType,\namountMinor, currency}\n[NO: glCode, voucherNo, beneficiaryName]| COORD_SVC
    WF -->|event: coordination.law_and_order.declared\n{eventId, districtCode, declarationType,\neffectiveAt, issuedByOfficeId}| COORD_SVC
    POL_WF -->|event: coordination.police.action_requested\n{eventId, districtCode, requestType,\nurgencyLevel}\n[NO: FIR number, complainant PII]| COORD_SVC
    COORD_SVC -->|Projects to\nPUNE-COORDINATION\nread-model DB| COORD_SVC
    COORD_SVC -->|notification.send\n{channel: DM_DASHBOARD,\nrecipient: PUNE-COLLECTORATE,\npurpose: district-coordination}| NOTIF
```

---

## Diagram 5 — Cell Provisioning Flow (Target, builds on existing install-service)

```mermaid
sequenceDiagram
    participant Admin as State Admin
    participant GW as gateway-service
    participant INSTALL as install-service
    participant TENANT as tenant-service
    participant TR as tenant-router<br/>(all services)
    participant KC as Keycloak
    participant INF as infra provisioner<br/>(Terraform / Helm)

    Admin->>GW: POST /api/v1/install/cells<br/>{ cellName, cellType: 'police', stateCode, region }
    GW->>INSTALL: forward
    INSTALL->>INSTALL: Validate; publish install.cell.create command
    INSTALL->>INF: Trigger: provision dedicated PG cluster<br/>dedicated Redis · S3 bucket · KMS key
    INF-->>INSTALL: DSN refs in Vault
    INSTALL->>INSTALL: INSERT install.cells [NEW TABLE]<br/>{ cellName, dbDsnRef, redisUrlRef, ... }
    INSTALL->>TENANT: POST /v1/internal/tenants\n{ name, edition, isolationTier: 'silo',\n  dbDsnRef, kmsKeyRef, orgCategory: 'district_police',\n  lgdDistrictCode, departmentCode }
    TENANT->>TENANT: INSERT tenant.tenants
    INSTALL->>INSTALL: INSERT install.tenant_cell_placements\n{ tenantId, cellId }
    INSTALL->>KC: Create district-police realm\nConfigure IdP federation → state Keycloak
    KC-->>INSTALL: realm created
    INSTALL->>TR: Cache invalidate (cachedResolver TTL=30s)
    Note over TR: Next sqlFor(policeDistrictTenantId)<br/>→ resolver → silo tier → dedicated PG client
    INSTALL-->>Admin: 201 Cell provisioned { cellId, tenantId }
```

---

## Legend

| Symbol | Meaning |
|---|---|
| `[VERIFIED]` | Code/schema/live DB confirmed exists |
| `[UNWIRED]` | Code built but not connected in production path |
| `[NEW]` | Does not exist today; must be built |
| `[ABSENT]` | Capability entirely missing |
| `pool-tier` | Shared PG cluster, shared Redis, shared S3; isolated by RLS `tenant_id` |
| `silo-tier` | Dedicated PG cluster, dedicated Redis, dedicated S3 per tenant/domain |
