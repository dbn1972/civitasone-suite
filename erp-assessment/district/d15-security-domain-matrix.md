# D15 — Security-Domain Matrix + Coordination Domain + Cross-Domain Audit

**Lane:** L06 · **Date:** 2026-07-13  
**Reviewer role:** Government Security Architect + Privacy/Compliance Expert  
**Source branch:** `court-management-service` · repo at `/tmp/cms-wt`

> **PREREQUISITE:** Cross-ref `08-tenant-isolation-report.md` (tenant isolation: 7/10), `d09-collectorate-gap.md`, `d10-police-gap.md`. This document establishes the DOMAIN-level isolation requirements above and beyond tenant-level RLS. Tenant isolation protects tenant A from tenant B; domain isolation protects Police data from Health data, within the same tenant/district.

---

## Part A — Security Domain Definitions

### A.1 Why Domain Isolation Matters Beyond RLS

Today's RLS isolates **tenants from each other** in a shared pool. It does NOT isolate **Police data from Finance data** or **Health data from Revenue data** — all of which share:

1. **Single PostgreSQL 16 cluster** — all 35 `civitas_*` databases on one host [VERIFIED: `docker exec civitasone-postgres psql -U civitas_admin -c "\l"` → 35 rows, one host]
2. **Single shared Redis** — all services use `process.env.REDIS_URL` from one source; no per-domain key namespace beyond `{service}:{tenant}:…` [VERIFIED: `packages/cache/src/index.ts:66-70` — `RedisCache` wraps one `ioredis.Redis` instance; no Redis Cluster or Sentinel per-domain]
3. **Single shared S3/MinIO bucket** — default `AWS_S3_BUCKET = "civitasone"` [VERIFIED: `packages/storage/src/index.ts:56`]; all departments write to the same bucket with key-path as the only separator
4. **Single Meilisearch instance** — `packages/search` references one `MEILI_URL`; no per-domain index isolation

**Consequence:** A compromised `finance_svc` Postgres credential gives the attacker read access to the finance DB only (correct). But a compromised Redis session, object storage credential, or Meilisearch API key exposes **all domains' cached data / documents / search indices** simultaneously. For a district platform carrying **Police operational data, patient health records, and financial PII on the same infrastructure**, this is a **P0 gap for Police and Treasury cells**.

---

### A.2 Security Domain Inventory

| Domain ID | Domain Name | Key Data | Statutory Sensitivity | Dedicated Cell Required? |
|---|---|---|---|---|
| DOM-01 | **Collectorate** | DM/Collector orders, land-acquisition, licensing, disaster coordination | `RESTRICTED` | Shared-logically-isolated (RLS + domain RBAC sufficient) |
| DOM-02 | **Police (SP/DGP)** | Police establishment, arms licensing, station duty roster, coordination event (NOT FIR/criminal intel — those live in CCTNS) | `CONFIDENTIAL` → `SECRET` for some sub-domains | **DEDICATED CELL** (separate PG cluster, Redis, S3, KMS) |
| DOM-03 | **Treasury / Finance** | Budget, vouchers, GL, payroll disbursement, DDO accounts, PFMS link | `CONFIDENTIAL` | **DEDICATED CELL** (separate PG cluster, Redis, S3, KMS per CERT-In §9) |
| DOM-04 | **Health (CMO)** | Patient records (via HMIS), staff medical claims, drug procurement | `CONFIDENTIAL` (patient) | Shared-logically-isolated + per-domain KMS key |
| DOM-05 | **Education (DEO)** | Student enrolment (via DISE), teacher postings, scholarship disbursement | `INTERNAL / RESTRICTED` | Shared-logically-isolated |
| DOM-06 | **Revenue / Land** | Land records interface (SoR = state land system), mutation requests, court orders, tehsildar dockets | `RESTRICTED` | Shared-logically-isolated + land-records adapter |
| DOM-07 | **Rural Development (BDO/DRDA)** | Scheme utilisation, MGNREGS muster rolls, SHG linkages, beneficiary lists | `RESTRICTED` | Shared-logically-isolated |
| DOM-08 | **Urban (ULB / Municipality)** | Property tax, trade licenses, water bills, building plans, ward data | `INTERNAL / RESTRICTED` | Shared-logically-isolated |
| DOM-09 | **Shared Coordination** | District coordination events (law-and-order, disaster, election, VIP, relief) — minimum-necessary shared record only | `RESTRICTED / CONFIDENTIAL` (per event_type classification) | Shared-read-only projection from owning domains |
| DOM-10 | **Analytics** | Aggregated cross-domain facts, dashboards, reports — NO individual PII | `INTERNAL` | Shared (analytics-service facts projection already built [VERIFIED: `analytics-service/src/modules/facts/consumer.ts:2`]) |

---

### A.3 Per-Domain Security Matrix

| Attribute | DOM-01 Collectorate | DOM-02 Police | DOM-03 Treasury/Finance | DOM-04 Health | DOM-05 Education | DOM-06 Revenue | DOM-07 Rural Dev | DOM-08 Urban | DOM-09 Coordination | DOM-10 Analytics |
|---|---|---|---|---|---|---|---|---|---|---|
| **DB isolation** | Shared PG cluster (existing per-service DB isolation sufficient) | **DEDICATED PG cluster** (`civitas_police_*` DBs) | **DEDICATED PG cluster** (`civitas_finance_*` DBs) | Shared PG cluster | Shared PG cluster | Shared PG cluster | Shared PG cluster | Shared PG cluster | Shared PG cluster (read-only projection) | Shared PG cluster |
| **Redis isolation** | Shared Redis (key-namespaced) | **DEDICATED Redis** (no shared keyspace with other domains) | **DEDICATED Redis** (no shared keyspace) | Shared Redis (key-namespaced) | Shared Redis | Shared Redis | Shared Redis | Shared Redis | Shared Redis | Shared Redis |
| **Object storage** | Shared bucket (`civitasone/collectorate/…`) | **DEDICATED bucket** (`civitasone-police`) with bucket policy `DenyAllExcept[police_svc]` | **DEDICATED bucket** (`civitasone-finance`) | Shared bucket (subfolder + object-ACL) | Shared bucket | Shared bucket | Shared bucket | Shared bucket | N/A (no attachments) | Shared bucket (export only) |
| **Search isolation** | Shared Meilisearch (per-tenant index prefix) | **DEDICATED Meilisearch** or index-level API-key restriction (Meili v1.2+ tenant tokens) | **DEDICATED Meilisearch** | Shared Meilisearch | Shared Meilisearch | Shared Meilisearch | Shared Meilisearch | Shared Meilisearch | N/A | Shared Meilisearch |
| **KMS encryption key** | Shared tenant KMS key | **Per-domain CMK** (AWS KMS / HashiCorp Vault) — separate key for police PII. Ref: `kmsKeyRef` col exists in tenant table [VERIFIED: `tenant-service/src/modules/tenant/schema.ts:22`] but all live tenants have `kms_key_ref = NULL` [VERIFIED: live query] | **Per-domain CMK** (Finance PII key) | Per-domain CMK (Patient PII) | Shared tenant key | Shared tenant key | Shared tenant key | Shared tenant key | N/A | Shared read key |
| **Audit access** | District admin, Collector | SP + senior officers; **NOT accessible to Finance/Health domain admins** | AG, CAG, Finance Controller; NOT accessible to Police/Health | CMO, Health Admin | DEO, Education Admin | DRO, Revenue | BDO, DRDA | ULB Commissioner | All participating domains (read-only) | Analytics admin (aggregate only) |
| **Network zone** | Internal district LAN + VPN | **Air-gapped VLAN** (police) OR strict NSG / AWS Security Group `AllowInbound[police_gateway_only]` | Internal + restricted outbound to PFMS / NACH / TRACES | Internal district LAN | Internal district LAN | Internal district LAN | Internal + citizen portal (public-facing subset) | Internal + ULB portal | Internal multi-dept | Internal BI subnet |
| **Admin roles** | `DISTRICT_ADMIN` | `POLICE_SUPER_ADMIN`, `SP_ADMIN` | `FINANCE_ADMIN`, `DDO_ADMIN` | `HEALTH_ADMIN`, `CMO_ADMIN` | `EDUCATION_ADMIN` | `REVENUE_ADMIN` | `RD_ADMIN` | `ULB_ADMIN` | `COORDINATION_ADMIN` (read across domains) | `ANALYTICS_ADMIN` |
| **Backup** | Daily PITR (≥7 days) | **Daily PITR ≥ 30 days** + offline copy per CERT-In; police operational data | **Daily PITR ≥ 7 years** (financial records retention law) | Daily PITR ≥ 7 years | Daily PITR ≥ 5 years | Daily PITR ≥ 7 years (land records) | Daily PITR ≥ 5 years | Daily PITR ≥ 7 years | Daily PITR ≥ 3 years | Daily PITR ≥ 2 years |
| **Data retention** | 7 years (GFR) | 30 years (establishment); operational logs 5 years; audit logs permanent | 7 years (CAG); vouchers permanent | 7 years (health records) | 7 years | Permanent (land records) | 7 years | 7 years | 5 years | 2 years |
| **DR target** | RPO 4h / RTO 8h | **RPO 1h / RTO 4h** | **RPO 1h / RTO 2h** | RPO 4h / RTO 8h | RPO 8h / RTO 24h | RPO 4h / RTO 8h | RPO 8h / RTO 24h | RPO 8h / RTO 24h | RPO 2h / RTO 4h | RPO 24h / RTO 48h |
| **API policy** | Internal JWT + RLS | **JWT + domain-header `X-Domain: police` + RBAC policy check in policy-service** | **JWT + domain-header `X-Domain: treasury` + MFA for DDO approve/disburse** | JWT + patient-consent check | JWT | JWT | JWT + beneficiary consent | JWT + citizen auth (OIDC) | JWT + participating-dept role | JWT + analytics role |

---

## Part B — Current State Assessment

### B.1 What Is Missing Today [VERIFIED GAP]

| Component | Current State | Gap |
|---|---|---|
| **DB isolation at domain level** | 35 per-service DBs on ONE shared PG cluster; all domain services share the cluster | No dedicated cluster for Police (DOM-02) or Finance (DOM-03). A PG superuser or cluster-level credential compromises all domains [VERIFIED: `\l` output — all on `civitas_admin`] |
| **Redis isolation at domain level** | All services read `REDIS_URL` — ONE shared Redis [VERIFIED: `packages/cache/src/index.ts:67`]; keys namespaced by `{service}:{tenant}:{resource}:{id}` only | Police session tokens and Finance session tokens coexist in the same Redis keyspace. A Redis DUMP or KEYS scan exposes all domains simultaneously |
| **S3/MinIO isolation at domain level** | Single bucket `"civitasone"` shared by all services [VERIFIED: `packages/storage/src/index.ts:56`]; object keys only differentiator | Police documents (arms license applications, complaint register scans) and Finance vouchers coexist in one bucket. IAM policy cannot restrict per-domain |
| **Meilisearch isolation** | Single shared instance inferred from `packages/search` → single `MEILI_URL` | All search indices share one Meilisearch; cross-domain full-text search leakage if index segregation not enforced by API-key policy |
| **KMS per-domain** | `kmsKeyRef` col exists in `tenant.tenants` schema [VERIFIED: `tenant-service/src/modules/tenant/schema.ts:22`]; **ALL 5 live tenants have `kms_key_ref = NULL`** [VERIFIED: live query — `kms_key_ref` column is NULL for all rows] | No per-domain CMK. All encrypted PII (hrms, payroll, citizen) uses the same per-service env-var key (`HRMS_PII_KEY`, `PAYROLL_PII_KEY`). Police cell cannot BYOK |
| **PII encryption coverage** | hrms (pan, aadhaar_ref, bank), payroll (bank, pan, deductee_pan), citizen (name, email, mobile, digilocker_token, address), visitor (name, phone, email, identity_doc), court, meeting, telephony — ALL using AES-256-GCM [VERIFIED per-service] | **Grant-service: 0 pii-crypto usage** [VERIFIED: `grep encryptedText services/grant-service/src --include="*.ts"` → 0 results]. Beneficiary data (Aadhaar used in APBS writer: `payroll/src/modules/bank-transfer/apbs-writer.ts:16`) is handled in payroll (encrypted) but grant-service beneficiary table does NOT encrypt beneficiary PII. **Finance-service: no pii-crypto** — payment beneficiary details not encrypted |
| **Tenant-router wiring** | `packages/db/src/tenant-router.ts` fully built — pool/silo/shard + LRU client cache + env resolver [VERIFIED: full file read] | NOT wired to any service. All services use a module-level `createSqlClient(DATABASE_URL)` singleton. The `isolationTier` field exists in tenant schema, all live tenants are `"pool"` [VERIFIED: live query]. Silo/shard routing requires services to call `router.sqlFor(tenantId)` — none do |
| **Enterprise cell placement** | `install.silo_provisions` + `provision-silo-tenant.mjs` built (per GROUNDED FACTS) | No cell registry, no placement engine, no tier-migration data-movement pipeline |

### B.2 Tenant-Router → Enterprise-Cell Gap

The tenant-router (`packages/db/src/tenant-router.ts`) is the **correct mechanism** for implementing dedicated domain cells [VERIFIED: full code read]. The path to domain isolation:

```
TODAY:  service → createSqlClient(DATABASE_URL)  ← all tenants, one pool DB
TARGET: service → router.sqlFor(tenantId)         ← pool tenants → shared DB
                                                    silo tenants → dedicated DB
```

For Police/Finance cells, the pattern is:
1. Onboard the police district as a **silo tenant** (set `isolationTier='silo'`, `dbDsnRef='vault://civitas/police-pg-dsn'`)
2. Each police-domain service resolves `router.sqlFor(policeTenantId)` → dedicated PG cluster
3. Wire a per-domain Redis prefix or dedicated Redis instance via a parallel `RedisRouter` (not yet built)
4. Wire per-domain S3 bucket via env-based routing (not yet built)

**What is BUILT:** `tenant-router` pool/silo/shard routing, `isolationTier`/`kmsKeyRef`/`dbDsnRef` cols, silo provisioning scripts.  
**What is UNWIRED:** No service calls `router.sqlFor()`; gateway module-guard + quota-check UNWIRED [VERIFIED: `d02-current-architecture.md §2`].  
**What is ABSENT:** Redis router, S3 bucket router, Meilisearch per-domain key policy, cell placement registry.

---

## Part C — Coordination Domain Design

### C.1 Why a Coordination Domain Is Needed

District law-and-order, disaster response, election duty, VIP security, and relief operations require **multiple departments to share a minimum-necessary situational record** without sharing their internal departmental data. The Collector needs Police and Health to both see "Cyclone Michaung: evacuation in progress, Block 3"; the SP needs this context without seeing patient health records; the CMO needs it without seeing police operational details.

**Current state: ABSENT** — grep across all 38 services returns 0 results for any district-level coordination schema, event topic, or coordination route. The `visitor-service` has `security_incidents` (physical access security) — unrelated.

### C.2 Coordination Service Design

**Module:** `coordination-service` (new, P1 before district pilot)  
**L1 rule:** `coordination_*` table prefix; DB `civitas_coordination`; role `coordination_svc NOBYPASSRLS`

#### C.2.1 Coordination Event JSON Schema

```json
{
  "$schema": "https://schema.civitasone.gov.in/coordination/event/v1",
  "coordination_event_id": "<UUID>",
  "tenant_id": "<UUID>",
  "district_id": "<UUID>",
  "event_type": "law_and_order | disaster | election | vip_security | relief | epidemic | industrial_accident",
  "classification": "restricted | confidential | secret",
  "location_reference": {
    "admin_unit_id": "<UUID>",
    "lgd_code": "<string>",
    "description": "<string>",
    "geo_point": { "lat": 0.0, "lon": 0.0 }
  },
  "owning_department": "<domain_id: DOM-01..DOM-08>",
  "participating_departments": ["<domain_id>"],
  "status": "active | standby | closed | escalated",
  "tasks": [
    {
      "task_id": "<UUID>",
      "assigned_to_dept": "<domain_id>",
      "description": "<string>",
      "due_at": "<ISO8601>",
      "status": "pending | in_progress | completed | overdue"
    }
  ],
  "resource_requirements": [
    {
      "resource_type": "force | ambulance | relief_goods | vehicle | personnel",
      "quantity": 0,
      "requested_from_dept": "<domain_id>",
      "status": "requested | allocated | deployed"
    }
  ],
  "situation_summary": "<string — max 2000 chars; NO case details, NO patient names, NO individual PII>",
  "correlation_id": "<UUID>",
  "created_at": "<ISO8601>",
  "updated_at": "<ISO8601>",
  "closed_at": "<ISO8601 | null>",
  "schema_version": "1.0"
}
```

**HARD RULE:** `situation_summary` MUST NOT contain FIR numbers, case diaries, patient identities, informer identities, or individual criminal records. It is a minimum-necessary operational descriptor. Each owning department retains full detail in its own domain service.

#### C.2.2 Drizzle Schema (DDL)

```typescript
// services/coordination-service/src/modules/event/schema.ts
import { pgSchema, uuid, varchar, text, jsonb, timestamp, integer } from "drizzle-orm/pg-core";

export const coordinationSchema = pgSchema("coordination");

export const coordinationEvents = coordinationSchema.table("coordination_events", {
  id:                      uuid("id").primaryKey().defaultRandom(),
  tenantId:                uuid("tenant_id").notNull(),
  districtId:              uuid("district_id").notNull(),   // FK to location.administrative_units
  eventType:               varchar("event_type", { length: 32 }).notNull(),
  classification:          varchar("classification", { length: 16 }).notNull().default("restricted"),
  locationReference:       jsonb("location_reference").$type<LocationRef>().notNull(),
  owningDepartment:        varchar("owning_department", { length: 8 }).notNull(),
  participatingDepts:      jsonb("participating_departments").$type<string[]>().notNull().default([]),
  status:                  varchar("status", { length: 16 }).notNull().default("active"),
  situationSummary:        text("situation_summary").notNull().default(""),
  correlationId:           varchar("correlation_id", { length: 64 }).notNull(),
  createdAt:               timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:               timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt:                timestamp("closed_at", { withTimezone: true }),
  createdBy:               uuid("created_by").notNull(),
  updatedBy:               uuid("updated_by").notNull(),
  version:                 integer("version").notNull().default(1),
});

export const coordinationTasks = coordinationSchema.table("coordination_tasks", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  eventId:           uuid("event_id").notNull(),  // opaque ref, no FK to coordination_events in another module
  assignedToDept:    varchar("assigned_to_dept", { length: 8 }).notNull(),
  description:       text("description").notNull(),
  dueAt:             timestamp("due_at", { withTimezone: true }),
  status:            varchar("status", { length: 16 }).notNull().default("pending"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

export const coordinationResources = coordinationSchema.table("coordination_resources", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  eventId:          uuid("event_id").notNull(),
  resourceType:     varchar("resource_type", { length: 32 }).notNull(),
  quantity:         integer("quantity").notNull(),
  requestedFromDept: varchar("requested_from_dept", { length: 8 }).notNull(),
  status:           varchar("status", { length: 16 }).notNull().default("requested"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});
```

#### C.2.3 Topics

```typescript
// services/coordination-service/src/topics.ts
export const COMMANDS = {
  eventCreate:   "coordination.event.create",
  eventUpdate:   "coordination.event.update",
  eventClose:    "coordination.event.close",
  taskAssign:    "coordination.task.assign",
  taskComplete:  "coordination.task.complete",
  resourceRequest: "coordination.resource.request",
  resourceAllocate: "coordination.resource.allocate",
} as const;

export const EVENTS = {
  eventCreated:    "coordination.event.created",
  eventUpdated:    "coordination.event.updated",
  eventClosed:     "coordination.event.closed",
  taskOverdue:     "coordination.task.overdue",
  resourceDeployed: "coordination.resource.deployed",
} as const;

export const CONSUMED_EVENTS = {
  // Receive escalation from citizen-service (disaster relief requests)
  citizenGrievanceEscalated: "citizen.grievance.escalated",
} as const;
```

#### C.2.4 API Contract

```
POST /coordination/events         → publish coordination.event.create → 202
GET  /coordination/events         → list active events for caller's tenant + participating_departments scoped to caller's domain RBAC
GET  /coordination/events/:id     → get event; classification gate: if classification=confidential, require X-Domain match
PATCH /coordination/events/:id    → publish coordination.event.update → 202
POST /coordination/events/:id/tasks        → assign task → 202
PATCH /coordination/events/:id/tasks/:tid → update task → 202
POST /coordination/events/:id/resources   → request resource → 202
```

**Access control:** `GET` returns only events where `owning_department = caller_domain OR participating_departments CONTAINS caller_domain`. Policy enforced in `policy-service` via ABAC attribute `coordination_participant`. `classification=secret` events require `X-Domain: police` + elevated role.

---

## Part D — Cross-Domain Exchange Audit

### D.1 Current State of Audit-Service [VERIFIED GAP]

The `audit-service` has a solid foundation:
- `events.events` table with `type`, `actor`, `target`, `payload`, `severity`, `prevHash` / `eventHash` (tamper-evident chain), `oldValue`, `newValue`, `correlationId`, `retainUntil` [VERIFIED: `services/audit-service/src/modules/events/schema.ts`]
- `oldValue` and `newValue` are `jsonb` columns, present in domain.ts and consumed by consumer [VERIFIED: `events/consumer.ts:40-62`]

**What is MISSING from the audit schema and EventEnvelope:**

| Required Field | Audit Schema Today | EventEnvelope (`packages/events/src/envelope.ts`) | Gap |
|---|---|---|---|
| `actor.role` (RBAC role at time of action) | `actor: jsonb` (freeform object, no enforced role field) | `actorId: string` only — no `actorRole` | Cross-domain audit cannot reconstruct *which role* authorised the exchange |
| `exchange_id` | ABSENT | ABSENT | Cannot correlate a cross-domain data exchange across source + target audit logs |
| `source_department` | ABSENT | ABSENT | Cannot identify the requesting department |
| `target_department` | ABSENT | ABSENT | Cannot identify the responding department |
| `fields_shared` | ABSENT | ABSENT | Cannot produce a minimal-disclosure report (DPDP §6: only data necessary for stated purpose) |
| `classification` | ABSENT | ABSENT | Cannot gate audit retention by classification tier |
| `legal_authority` | ABSENT | ABSENT | No statutory basis recorded for the exchange (required by DPDP §4, IT Act §43A) |
| `api_version` | ABSENT | `schemaVersion` (of envelope, not API) | Cannot reproduce the contract version in force at exchange time |
| `purpose_code` | PRESENT in PFMS adapter only (`finance-service/src/modules/pfms/adapter.ts:25`) | ABSENT from EventEnvelope | Purpose not captured for non-PFMS exchanges |
| `disposition` | ABSENT | ABSENT | No record of what the recipient did with the data |

**Finance/HRMS/payroll consumers:** `actorId` flows correctly in command messages and is stored. However, `actor.role` is not emitted in any consumer [VERIFIED: `packages/events/src/index.ts:17` — `actorId: string` only; `payroll-service/src/modules/payroll/consumer.ts` writes `actorId` but never `actorRole`].

### D.2 Required Cross-Domain Exchange Audit Event

Every API or event-based data exchange crossing a domain boundary MUST emit a `cross_domain_exchange` audit event with the following contract:

```typescript
// packages/events/src/cross-domain-exchange.ts [PROPOSED — NEW FILE]

export interface CrossDomainExchangePayload {
  exchange_id:       string;    // UUID, unique per exchange
  source_dept:       string;    // DOM-01..DOM-10 domain ID
  target_dept:       string;    // DOM-01..DOM-10 domain ID
  purpose_code:      string;    // e.g. "payroll_disbursement", "grievance_routing", "scheme_verification"
  legal_authority:   string;    // e.g. "GFR Rule 145", "DPDP Act 2023 §4", "IT Act 2000 §43A", "RTI Act 2005 §7"
  resource_type:     string;    // "employee_posting", "payment_record", "grievance", etc.
  resource_ids:      string[];  // opaque IDs of records exchanged
  fields_shared:     string[];  // explicit list of field names shared; empty = no field-level tracking
  classification:    "public" | "restricted" | "confidential" | "secret";
  api_version:       string;    // e.g. "v1.2"
  actor_role:        string;    // RBAC role of the requesting user at exchange time
  response_status:   "success" | "denied" | "partial";
  disposition:       "consumed" | "forwarded" | "archived" | "purged";
  retention_until:   string;    // ISO8601 — per classification: secret=30y, confidential=7y, restricted=3y, public=1y
  correlation_id:    string;
  occurred_at:       string;    // ISO8601
}

// Topic: "audit.cross_domain.exchange"
// Emitted by: any service that exposes data to another domain via HTTP or event
// Consumed by: audit-service → stored in events.events with type = "cross_domain_exchange"
```

#### D.2.1 Audit Schema Extension (DDL)

```sql
-- Migration: services/audit-service/migrations/0009_cross_domain_exchange.sql
ALTER TABLE events.events
  ADD COLUMN IF NOT EXISTS exchange_id       uuid,
  ADD COLUMN IF NOT EXISTS source_dept       varchar(8),
  ADD COLUMN IF NOT EXISTS target_dept       varchar(8),
  ADD COLUMN IF NOT EXISTS fields_shared     jsonb,
  ADD COLUMN IF NOT EXISTS legal_authority   varchar(512),
  ADD COLUMN IF NOT EXISTS classification    varchar(16),
  ADD COLUMN IF NOT EXISTS api_version       varchar(16),
  ADD COLUMN IF NOT EXISTS actor_role        varchar(128),
  ADD COLUMN IF NOT EXISTS disposition       varchar(16),
  ADD COLUMN IF NOT EXISTS purpose_code      varchar(64);

CREATE INDEX IF NOT EXISTS events_exchange_id_idx ON events.events (exchange_id) WHERE exchange_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_source_target_dept_idx ON events.events (source_dept, target_dept, occurred_at DESC)
  WHERE source_dept IS NOT NULL;
```

#### D.2.2 EventEnvelope Extension (Packages)

```typescript
// packages/events/src/envelope.ts — ADD to eventEnvelopeSchema:
actorRole:     z.string().optional(),  // RBAC role at time of action
exchangeId:    z.string().uuid().optional(),  // set only for cross-domain exchanges
sourceDept:    z.string().max(8).optional(),
targetDept:    z.string().max(8).optional(),
purposeCode:   z.string().max(64).optional(),
legalAuthority: z.string().max(512).optional(),
fieldsShared:  z.array(z.string()).optional(),
classification: z.enum(["public", "restricted", "confidential", "secret"]).optional(),
```

#### D.2.3 Where Cross-Domain Exchange Events Must Be Emitted

| Exchange Point | Current Emission | Required Addition |
|---|---|---|
| `hrms-service` → `payroll-service` (`hrms.employee.*` events consumed by payroll) | actorId only | `actorRole`, `exchangeId`, `sourceDept=DOM-01`, `targetDept=DOM-03`, `purposeCode=payroll_processing`, `legalAuthority=GFR Rule 154` |
| `finance-service` → PFMS (`pfms/adapter.ts`) | No audit event emitted | `cross_domain.exchange` with `sourceDept=DOM-03`, `targetDept=external:pfms`, `fieldsShared=["amount","purposeCode","ddoCode"]` |
| `citizen-service` → `workflow-service` (grievance routing) | actorId only | `exchangeId`, `sourceDept=DOM-09`, `targetDept=DOM-<receiving dept>`, `purposeCode=grievance_routing`, `legalAuthority=RTI Act 2005 §7` |
| `grant-service` → analytics-service (scheme facts) | actorId only | `purposeCode=scheme_monitoring`, `fieldsShared=["disbursement_amount","beneficiary_count"]` (NO individual beneficiary PII in analytics) |
| Any service → `coordination-service` (district event update) | ABSENT (service doesn't exist yet) | Full `cross_domain_exchange` event mandatory for all coordination reads |

---

## Part E — Prioritised Remediation Plan

| Priority | Gap | Implementable Action |
|---|---|---|
| **P0** | Police domain shares Redis/S3/Meilisearch with all other domains | Provision dedicated Redis endpoint for Police cell; set `REDIS_URL=redis://police-redis:6379` in `hrms-service`+`court-service` for police tenants; add `POLICE_S3_BUCKET` env var routing |
| **P0** | All live tenant `kms_key_ref = NULL` | Create KMS keys per domain; populate `tenant.tenants.kms_key_ref`; wire `HRMS_PII_KEY` / `PAYROLL_PII_KEY` resolution from KMS ref (not static env) |
| **P0** | `grant-service` has no PII encryption for beneficiary data | Add `pii-crypto.ts` (copy hrms pattern); encrypt beneficiary `aadhaar_ref`, `bank_account_no`, `mobile` in grant schema |
| **P1** | Finance-service has no PII encryption on payment beneficiary | Add `encryptedText` to payment beneficiary fields in `finance-service/src/modules/payments/schema.ts` |
| **P1** | Coordination domain: zero implementation | Create `coordination-service` with DDL in §C.2.2, events in §C.2.3, API in §C.2.4 |
| **P1** | Cross-domain exchange not tracked in audit | Apply DDL migration §D.2.1; extend EventEnvelope §D.2.2; emit `cross_domain_exchange` events at the 5 exchange points in §D.2.3 |
| **P1** | `actor.role` absent from all audit events | Add `actorRole` to `EventEnvelope` (packages/events/src/envelope.ts); populate from JWT `realm_access.roles[0]` in route handlers before publishing command |
| **P1** | No CCTNS / land-records / CPGRAMS adapters | Build `packages/gov-adapters/src/cctns/client.ts`, `land-records/client.ts`, `cpgrams/client.ts` (read-only, circuit-breakered) |
| **P2** | No citizen certificate-issuance module | Add `certificate/` module to `citizen-service`: schema (`citizen_certificates`), commands (`certificate.issue`), event (`certificate.issued`), DigiLocker push adapter |
| **P2** | Treasury DB not on dedicated cluster | When district pilot scale warrants: onboard Finance/Treasury tenants as `isolationTier=silo`, wire `router.sqlFor(tenantId)` in finance-service (tenant-router already built) |
| **P2** | Per-domain Meilisearch isolation | For Police: generate Meilisearch tenant token scoped to `police_*` indices (Meilisearch v1.2+ supports tenant tokens per-API-key) |
| **P3** | No cell placement registry | Build `coordination-service/cell-registry` table + placement engine: maps district → cell allocation (PG DSN, Redis, S3 bucket) per domain |

---

## Summary

**Security-domain readiness score: 3/10**

The score reflects:
- **DB-per-service isolation is correct and proven** (+2)
- **PII encrypted in 7/10 services** (+1)
- **Tenant-router and isolationTier built** (+1, but entirely unwired = 0 runtime effect)
- **DEDUCTED:** Single Redis/S3/Meilisearch across all domains (Police and Finance share infrastructure with all other departments, −2 for P0 risk)
- **DEDUCTED:** Zero domain-level KMS keys provisioned (−1)
- **DEDUCTED:** Cross-domain exchange audit completely absent — no `exchangeId`, `actorRole`, `fieldsShared`, `legalAuthority` in any event or audit row (−1)
- **DEDUCTED:** Coordination domain entirely absent — no module, no schema, no events (−1)
- **DEDUCTED:** grant-service PII plaintext; certificate-issuance absent; CCTNS/land/CPGRAMS adapters absent (−1)

The infrastructure primitives (tenant-router, RLS, pii-crypto pattern, audit schema) are sound. The gap is the **governance wiring**: no domain-level routing, no per-domain KMS provisioning, no cross-domain exchange audit, no coordination service.
