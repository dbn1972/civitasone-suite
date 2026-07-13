# D26 — District Governance Platform Roadmap

**Lane L10 · Review Board Chair · 2026-07-13 · Branch: court-management-service**

> Sequence is strict: nothing in Phase-2+ works until Phase-0 org model ships. Read Phase-0 as a hard prerequisite gate.

---

## 7-Phase Architecture Roadmap

### Phase-0 — Architecture + Security Foundation (Gate: Before ANY Pilot)

**Exit criteria:** Org model in DB; backup running; tenant isolation uniform; circuit breakers complete; no P0 security gaps.

| Work Item | Owner Service | Type | Effort |
|---|---|---|---|
| Migrate `hierarchy.administrative_units` and `jurisdiction.jurisdictions` to live DB | location-service | Migration | S |
| Replace `unit_type` PG enum with `hierarchy.unit_types` lookup table; add `subdivision, tehsil, division, police_station, ulb, village, beat` | location-service | Migration + DDL | M |
| Create `hierarchy.offices`, `hierarchy.positions`, `hierarchy.postings` tables | location-service | New DDL | M |
| Add `parentTenantId, lgdCode, officeType, departmentCode, cellId` to `tenant.tenants` | tenant-service | Migration | S |
| Build `install.cells` + `install.tenant_cell_placements` tables + placement API | install-service | New DDL + routes | M |
| Wire `TenantRouter` into all 38 services (replace `DATABASE_URL` singleton) | packages/db + all services | Mechanical | L |
| Wire module-guard in gateway (remove TODO at `module-guard.ts:12-14`) | gateway-service | Small fix | S |
| Complete Wave 2 read-path fix for ~23 services | 23 services | Mechanical | M |
| Fix route-write path: `db.execute` in finance (3), hrms (61), identity (16) | finance, hrms, identity | Mechanical | M |
| Set `workflow_svc NOBYPASSRLS`; transfer `civitas_court` owner to `court_svc` | infra/DB | Config | XS |
| Enable RDS automated backups + WAL archiving to S3 per cell; test PITR | infra/aws | Infra | L |
| Extend `CivitasJwtPayload` + `RequestContext` with office/position/jurisdiction claims | packages/types + packages/auth | Schema + code | M |
| Enrich JWT at login from `hierarchy.postings` (identity-service) | identity-service | New feature | M |
| Fix payroll→finance GL topic mismatch (`runDisbursed` → `runFinalized`) | payroll-service | 1-line fix | XS |
| Fix `audit.event.record` to include `oldValue`/`newValue` for all mutations | all services | Medium | M |
| Data classification policy: add `classification` + `retentionPolicy` to event envelope | packages/events | Schema | S |
| Security domain column `security_domain` on `hrms_departments` + RLS policy | hrms-service | Small migration | S |
| Fix grant-service 63% test failure (disbursement approval consumer) | grant-service | Bug fix | M |
| Fix identity-service 24% test failure | identity-service | Bug fix | M |
| Fix estab-service 20% test failure; fix DSC e-sign path | estab-service | Bug fix | M |
| Create `smtp-sender.ts` in notification-service | notification-service | Bug fix | XS |
| Add circuit breaker to `payroll→hrms` call-site | payroll-service | Small fix | S |
| Apply `encryptedText()` to all PII fields in grant-service | grant-service | Medium | M |

---

### Phase-1 — Collectorate Internal ERP

**Exit criteria:** A single district Collectorate can use the system for all internal administrative functions. No inter-office coordination yet.

**Dependency:** Phase-0 fully complete.

| Work Item | Owner Service | Type | Effort |
|---|---|---|---|
| Seed admin geography: LGD state/district/block/GP hierarchy for pilot district | location-service | Data seeding | S |
| Register Collectorate as a tenant with `officeType: 'collectorate'`, `lgdCode`, `departmentCode: 'CIVIL'` | tenant-service | Config | S |
| Create offices: Collectorate, SDM offices, Tehsil offices in Office Registry | location-service | Config + seed | S |
| Seed positions: Collector, ADM, SDM, Tehsildar, Block DevelopmentO Officer with financial powers | location-service | Config + seed | S |
| Create postings for pilot district officers | identity-service + location-service | Config | S |
| Configure finance-service: HOA codes, DDO code, PAO code, treasury code for Collectorate | finance-service | Config | S |
| Configure workflow-service: executive-magisterial templates (Sec-144, Sec-107, procession permission) | workflow-service | Workflow seed | M |
| Apply revenue court vertical preset; register Collector Court + SDM Court + Tehsildar Courts | court-service | Config | S |
| Configure citizen-service SLA rules for grievance routing to Collectorate | citizen-service | Config | S |
| Configure grant-service: MNREGS, PM-AWAS scheme codes for pilot district | grant-service | Config | S |
| Build CPGRAMS adapter in gov-adapters; wire into citizen-service | packages/gov-adapters + citizen-service | New | M |
| Add `service-catalog` L2 module in citizen-service for certificate issuance | citizen-service | New module | M |
| Add `grievance.assigned_office_id` + `jurisdiction_unit_id` to citizen.grievances | citizen-service | Schema extension | S |
| Configure analytics-service: district-dashboard preset KPIs | analytics-service | Config | S |
| Apply `kmsKeyRef` → per-tenant CMK derivation (police/treasury tenants) | packages/db + all PII services | Medium | M |
| Configure meeting-service: DPC, DISHA committee formats | meeting-service | Config | S |
| Enable eCourts adapter (`ECOURTS_ENABLED=true`, configure `ECOURTS_BASE_URL`) | legal-service | Config | S |

---

### Phase-2 — SDM / Tehsil / Revenue Administration

**Exit criteria:** SDM and Tehsildar offices separately scoped; revenue court fully operational; mutation proceedings supported.

**Dependency:** Phase-1 complete; land records adapter negotiated with state.

| Work Item | Owner Service | Type | Effort |
|---|---|---|---|
| Activate SDM and Tehsil offices with jurisdiction scoping from Office Registry | location-service | Config | S |
| Build land records adapter (`gov-adapters/land-records/`) with state-specific implementations | packages/gov-adapters | New | M |
| Add `government-land` L2 module in asset-service | asset-service | New module | M |
| Build `revenue-recovery` L2 module in court-service (demand certificate, coercive action, recovery payment) | court-service | New module | M |
| Add case-parcel lock mechanism for concurrent proceedings on same survey number | court-service | Schema extension | S |
| Implement licensing-service (arms, liquor, trade, explosive) | New service | New service | L |
| Add election-coordination workflow templates + ECI API adapter | workflow-service + packages/gov-adapters | New | M |
| Build disaster-service module at tehsil/block level (relief camps, affected HH) | coordination-service | New module | M |
| Integrate IFMS/state treasury adapter (state-specific) | packages/gov-adapters | New | M |

---

### Phase-3 — SP / Police Administration

**Exit criteria:** SP office, DSP offices, and police stations registered; police HR, payroll, eOffice, duty roster, deployment management operational; Police Dedicated Cell provisioned.

**Dependency:** Phase-0 (org model with police domain support); Police Dedicated Cell infra.

| Work Item | Owner Service | Type | Effort |
|---|---|---|---|
| Provision Police Dedicated Cell (dedicated PG + Redis + S3 + CMK per state) | infra/aws | Infra | L |
| Provision per-cell Keycloak realm (police realm + state IdP federation) | infra/onprem | Infra | L |
| Seed police hierarchy: Range, Zone, SP, DSP, Circle, PS, Beat offices | location-service | Seed | M |
| Configure police HR: IPS/PPS cadre columns, rank order, police leave types | hrms-service | Config + migration | M |
| Build police-admin service: duty-roster, deployment-management, arms-register, station-inspection modules | New service | New service | XL |
| Build coordination-service: force-requisition, DM↔SP coordination workflows | New service | New service | XL |
| Build CCTNS adapter (read-only: crime stats, FIR verify) | packages/gov-adapters | New | M |
| Build ICJS adapter (read-only: summons/warrant status) | packages/gov-adapters | New | M |
| Configure citizen-service SLA rules for police grievance routing | citizen-service | Config | S |
| Add `disaster.incident.declared.v1` event → coordination-service police force requisition | coordination-service | New event | S |

---

### Phase-4 — Blocks / Panchayats / Rural Development

**Exit criteria:** BDO offices, Gram Panchayats, and village-level revenue entities operational; MNREGS/PMAY scheme monitoring; geo-tagged project progress.

**Dependency:** Phase-2 complete; PFMS scheme module operational.

| Work Item | Owner Service | Type | Effort |
|---|---|---|---|
| Seed block/GP administrative units from LGD master for pilot state | location-service | Data seeding | M |
| Build scheme-registry module (gov_authorities, scheme_masters, scheme_targets, scheme_indicators) | grant-service or new service | New module | L |
| Add `scheme_master_id` FK to `grant_schemes` and `project_schemes` | grant-service + project-service | Schema extension | S |
| Fix `project.location` → `unit_id` FK to `hierarchy.administrative_units` | project-service | Schema extension | S |
| Configure MNREGS, PMAY, JJM, PMGSY scheme codes with ministry authority linkage | scheme-registry | Config | M |
| Build beneficiary aggregate cross-tenant read-model (no PII in payload) | analytics-service | New module | M |
| Add PFMS inbound adapter (fund release + UC tracking) | packages/gov-adapters | New | M |
| Add `disaster.village.relief_distributed.v1` event chain from block to tehsil to district | coordination-service | New events | M |
| Configure analytics-service: block-level scheme KPI dashboards | analytics-service | Config | S |

---

### Phase-5 — Line Departments Onboarding

**Exit criteria:** At least 8 line departments (Health, Education, Agriculture, PWD, Forest, Social Welfare, Irrigation, Urban) configured per state; inter-department workflows operational.

**Dependency:** Phase-1 complete; metadata-service functional; module-guard operational.

| Work Item | Owner Service | Type | Effort |
|---|---|---|---|
| Build metadata-service (routes.ts + consumer.ts + topics.ts + gateway entry) | metadata-service | New build | L |
| Migrate hardcoded vocabulary in 32 services to metadata-service entries | All services | Refactor | XL |
| Configure Health: CMO office, PHC structure, HMIS adapter (read-only aggregate) | location-service + hrms-service | Config | M |
| Configure Education: DEO office, school-level units, DISE read-only adapter | location-service + hrms-service | Config | M |
| Build automated department onboarding workflow (template: 5 configuration steps) | install-service + admin-service | New | M |
| Wire module-guard to per-department edition entitlements | admin-service | Config | S |
| Add cross-department coordination (health + disaster, education + election duty) | coordination-service | New modules | M |
| Configure Urban/ULB: property-tax finance module, ward offices | finance-service + location-service | Config | M |

---

### Phase-6 — State Integration

**Exit criteria:** State control plane operational; 30+ districts federated to one state cell set; district→state reporting chains working; state IFMS integrated.

**Dependency:** Phase-1–3 complete; parent-tenant model operational.

| Work Item | Owner Service | Type | Effort |
|---|---|---|---|
| Provision State Control Plane Cell (one per state: 36 nationally) | infra/aws | Infra | XL |
| Build cross-cell event router (per-cell SQS prefix + state fan-out) | queue-service | New | L |
| Implement pool→silo data migration pipeline for Police/Treasury cells | install-service | New wizard stage | L |
| Build state control plane tenant registry (all district tenants of a state) | tenant-service | New module | M |
| Implement `scheme.progress_report.submitted.v1` → state aggregation pipeline | report-service + analytics-service | New | M |
| Build state secretariat tenant with district oversight permissions | tenant-service | Config | M |
| Add `scheme.uc.validated.v1` → state treasury UC acceptance flow | grant-service | New event | S |
| Implement state DISHA dashboard (scheme KPIs across all districts) | analytics-service | New dashboard | M |
| Add LGD API adapter for hierarchy sync from NIC LGD master | packages/gov-adapters | New | M |
| Wire distributed schema registry backed by state control plane DB | packages/events + admin-service | New | M |

---

### Phase-7 — Ministry Integration

**Exit criteria:** Ministry authority registry complete; central fund flows automated; national dashboards operational without touching district OLTP.

**Dependency:** Phase-6 complete; per-ministry data-sharing agreements signed.

| Work Item | Owner Service | Type | Effort |
|---|---|---|---|
| Build `scheme_registry.data_sharing_agreements` table; per-ministry DSA onboarding | scheme-registry | New | M |
| Build PFMS state-node integration (GOO → district finance receipt) | finance-service | New | M |
| Build ministry portal push adapters (DISHA, PM-GatiShakti, e-Sampada) | packages/gov-adapters | New | XL |
| Build Ministry Integration Cell (cross-state analytics; national scheme aggregation) | infra/aws + analytics-service | Infra + new | XL |
| Add DigiLocker state gateway adapter for citizen certificate push | packages/gov-adapters | New | M |
| Add UMANG API adapter for citizen-facing mobile integration | packages/gov-adapters | New | M |
| Add NeSDA adapter for digital certificate issuance | packages/gov-adapters | New | M |
| Add purpose-based access (DPDP §3 purpose-code enforcement) at gateway | gateway-service + policy-service | New | L |
| Build field-level disclosure filtering (RBAC at field level, not endpoint level) | packages/auth + all services | New | XL |
| DR automation: monthly PITR drill; automated verification | infra/aws + DevOps | Infra | M |

---

## 30 / 90 / 180 / 365-Day Action Plan

### Day 30 — Security + Foundation (Priority: P0 survival)

| Day | Action | Who |
|---|---|---|
| 1–2 | Set `workflow_svc NOBYPASSRLS`; transfer `civitas_court` owner to `court_svc`; fix gateway payroll topic | DBA / SRE |
| 3–5 | Enable RDS automated backups + WAL archiving for all 35 DBs (minimum: daily snapshot + 7-day PITR) | SRE |
| 6–10 | Wave 2 read-path fix: 23 remaining services (mechanical, apply same pattern as Phase B) | Backend team |
| 11–15 | Route-write fix: finance (3), hrms (61), identity (16) bare `db.execute` routes | Backend team |
| 16–20 | Fix grant-service test failures (63%); fix identity-service test failures (24%) | Domain teams |
| 21–25 | Create `smtp-sender.ts`; add circuit breaker `payroll→hrms`; wire module-guard | Platform team |
| 26–30 | Fix `oldValue`/`newValue` in audit events; apply `encryptedText()` to grant-service PII | Platform team |

**Day 30 gate: All P0 security gaps closed; backup running; RLS uniform.**

### Day 90 — Org Model + Collectorate Pilot (Phase-0 + Phase-1)

| Day | Action | Who |
|---|---|---|
| 31–45 | Run `hierarchy.*` migrations; build `hierarchy.unit_types` lookup; seed civil admin units from LGD for 1 pilot district | Backend team |
| 46–60 | Build `hierarchy.offices`, `hierarchy.positions`, `hierarchy.postings` DDL + APIs | Backend team |
| 61–70 | Add tenant federation columns; build cell registry + tenant_cell_placements | Backend team |
| 71–80 | Extend JWT claims with `office_id`, `position_id`, `jur_unit_ids`; enrich at login | Auth team |
| 81–90 | Configure pilot district (1 Collectorate): seed offices, positions, postings; configure finance HOA; activate analytics dashboard | Domain team + pilot team |

**Day 90 gate: 1 Collectorate can run internal ERP with jurisdictional scoping.**

### Day 180 — Revenue + SDM + Court (Phase-2)

| Day | Action | Who |
|---|---|---|
| 91–110 | Build coordination-service skeleton (event-permissions, grievance-routing, disaster basic) | New team |
| 111–130 | Build CPGRAMS adapter; build land-records adapter (1 pilot state); build revenue-recovery module | Gov-adapters team |
| 131–150 | Activate revenue court vertical preset + 3 court levels; configure CPGRAMS routing | Pilot team |
| 151–165 | Build licensing-service (arms, liquor stubs) | Backend team |
| 166–180 | Build metadata-service routes; migrate 5 highest-priority hardcoded vocabularies | Platform team |

**Day 180 gate: SDM + Tehsil offices operational; revenue court running; CPGRAMS integrated; disaster module live.**

### Day 365 — Police + RD + Line Departments (Phase-3 + Phase-4 + partial Phase-5)

| Day | Action | Who |
|---|---|---|
| 181–220 | Provision Police Dedicated Cell; provision Keycloak police realm; build police-admin service (duty-roster, deployment, arms-register) | Platform + Infra |
| 221–260 | Build coordination-service: Collector↔SP force-requisition, disaster coordination, election module | Coordination team |
| 261–300 | Build scheme-registry; add ministry authority entities; wire PFMS inbound adapter | Finance team |
| 301–330 | Build BDO + Gram Panchayat offices; configure MNREGS + PMAY schemes; activate geo-tagged project monitoring | RD team |
| 331–365 | Onboard 3 line departments (Health, Education, Agriculture) using standard onboarding template | Domain teams |

**Day 365 gate: Full district ecosystem (Collectorate + SP + SDM + BDO + GPs + 3 line depts) operational; state integration design approved.**

---

## Phase Sequencing Constraint (Non-Negotiable)

```
Phase-0 (Org Model + Security Foundation)
  └─ ALL other phases depend on this
       Phase-1 (Collectorate ERP)     ← depends on: Phase-0 complete
         Phase-2 (SDM/Tehsil/Revenue) ← depends on: Phase-1 org model seeded
           Phase-3 (Police)           ← depends on: Phase-0 police domain + Phase-2 coordination-service skeleton
           Phase-4 (RD/Panchayat)     ← depends on: Phase-2 + scheme-registry
           Phase-5 (Line Depts)       ← depends on: Phase-1 + metadata-service built
             Phase-6 (State)          ← depends on: Phase-1–3 + parent-tenant model
               Phase-7 (Ministry)     ← depends on: Phase-6 + data-sharing agreements
```

Nothing above Phase-0 is useful until the org model exists in the database.
