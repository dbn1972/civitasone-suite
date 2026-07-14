# D01 — Executive Summary: Can CivitasOne Become a District Governance Platform?

**Lane L10 · Review Board Chair · 2026-07-13 · Branch: court-management-service**

---

## The One Structural Truth

**The current data model is `Tenant → Department → User` — three levels. District governance requires at minimum twelve: Ministry → State Secretariat → DGP/Commissioner → Division → District Collector/SP → SDM → Tehsil → Block/BDO → Police Station → ULB → Panchayat → Village.**

This is not a deficiency in how the system works — it is a missing architectural layer. The `hierarchy.administrative_units` and `jurisdiction.jurisdictions` tables exist in TypeScript code but have **never been migrated to the live PostgreSQL database** [VERIFIED: `civitas_location` DB contains only `location.locations`; `\dt` returns zero rows for `hierarchy.*` or `jurisdiction.*`]. The unit-type enum contains six values (`state, district, block, gp, ward, zone`) and excludes the four most critical intermediate levels for district administration: `subdivision` (SDM), `tehsil`, `division`, and `police_station`. No `offices` entity, no `positions` entity, and no `postings` entity exist anywhere in the 38-service codebase. The `RequestContext` carried on every request contains `tenantId`, `actorId`, and `roles[]` — and nothing else [VERIFIED: `packages/types/src/index.ts:71`].

Until this org model is built and migrated, no office can be distinctly registered, no officer can be scoped to a jurisdiction, no SDM can be fenced from another SDM's files, and no Collector↔SP coordination event can carry an authoritative office reference.

---

## Strong Internal ERP — Honest Assessment

CivitasOne is a **genuine, well-engineered, government-domain-aware internal ERP**. The evidence is compelling:

| Strength | Verified Evidence |
|---|---|
| DB-per-service, FORCE RLS, no cross-DB grants | 35 `civitas_*` databases, 35 per-service `*_svc` NOSUPERUSER NOBYPASSRLS roles [`\l` output] |
| CQRS + transactional outbox + idempotent consumers | `packages/outbox`, `_outbox.messages`, `_inbox.processed` markProcessed-first on all consumers |
| Tenant isolation fail-closed | 7/10 score [08-tenant-isolation-report.md]; no cross-tenant leak found; DB enforcement proven for 12 services |
| Finance double-entry + government HOA/DDO/PAO coding | `finance-service` 39 tables, PFMS validators [pfms.ts:10-47], bigint minor-units, period-close |
| Payroll statutory correctness | 90/90 field matches vs independent oracle across 8 statutory cases |
| eOffice + CSMOP file system | `estab-service` 42 tables, DFA, noting, file classification, DSP numbering |
| Court-service (this branch) | 22 tables, 73 routes, CPC §5–§35.5 compliance, CNR UUIDv5, DSC maker-checker, SHA-256 evidence chain, DPDP AES-256-GCM PII at rest |
| 62 active async event pairs | Transactional outbox + DLQ + schema registry (in-memory) |
| Gov-adapters: GSTN, NACH, PFMS, TRACES | 4 outbound statutory adapters verified in `packages/gov-adapters/` |

**The substrate is production-grade for a single-department internal ERP**. It is **NOT yet a federated district governance platform**.

---

## Top 5 P0 Blockers Before Any District Pilot

| # | Blocker | Root Gap | Evidence |
|---|---|---|---|
| **1** | **Org model not built** — no offices, positions, postings in any live DB | `hierarchy.*` tables exist only in TypeScript code; never migrated | `docker exec civitasone-postgres psql -d civitas_location -c "\dt"` → 0 rows for hierarchy.* |
| **2** | **Administrative hierarchy incomplete** — unit-type enum hardcoded at 6 values; missing `subdivision`, `tehsil`, `division`, `police_station`, `ulb`, `village` | Cannot represent an SDM office, a Tehsildar court, or a Police Station as distinct geographic entities | `location-service/src/modules/hierarchy/validators.ts:4` — `as const` hardcoded array |
| **3** | **No federated-tenant model** — `tenant.tenants` has no `parentTenantId`, `lgdCode`, `officeType`, or `departmentCode` columns | Districts cannot be structured as per-department tenants under a state control plane; all 640 districts cannot be federated | `tenant-service/src/modules/tenant/schema.ts` — verified missing columns |
| **4** | **No district coordination domain** — zero Collector↔SP workflows, no disaster module, no CPGRAMS integration beyond a 3-line stub | The DC's most critical functions (law-and-order, disaster response, election coordination, force requisition) are entirely absent | `grep -rn "coordinator\|disaster\|laworder" services/*/src --include="*.ts"` → 0 domain hits |
| **5** | **No backup / PITR** — RDS Terraform module commented out; no WAL archiving; no scheduled pg_dump; no recovery path | A single disk failure = total data loss across 35 databases holding HR, payroll, finance, and citizen records | `infra/aws/envs/production/main.tf:12-15` — `module "rds"` commented out |

---

## District Governance Platform Distance: Honest Estimate

| Phase | Work Required | Honest Timeline |
|---|---|---|
| **Collectorate internal ERP** (generic modules only) | Config + Org model migration + backup | **3 months** |
| **Limited district pilot** (Collectorate + Revenue + Court) | Org model + coordination-service (basic) + disaster module + CPGRAMS | **6 months** |
| **District-ready with major additions** (all 9 dept domains, SDM/Tehsil, Police admin) | Full P0+P1 list; Police/Treasury silo cells; 45 new event topics | **12 months** |
| **State-federated district-ready** (640 districts, state control plane, ministry scheme flows) | Cell registry; state control plane; ministry adapters; 36 state onboardings | **24 months** |
| **Ministry-integrated + world-class** | Ministry authority registry; PFMS inbound; CCTNS adapter; cross-state analytics | **36+ months** |

---

## Summary Verdict

CivitasOne is a **strong internal-ERP base** that a district Collectorate could use today for HR, payroll, finance, procurement, eOffice, and meetings — the core administrative back-office. It is **not a federated district governance platform** because the org model that enables office-scoped access, multi-department isolation, and 12-level hierarchy does not exist in the database. The gap is structural but not architectural — the target architecture (D16 Option D hybrid federation) is sound and builds on genuine primitives that exist in the codebase. The distance is 6–12 months of focused engineering, not a rebuild.

**Overall district governance readiness: 3/10.**
