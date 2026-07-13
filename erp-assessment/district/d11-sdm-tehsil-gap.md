# D11 — SDM / Tehsil / Revenue Circle Capability Gap Assessment

**Lane:** L03 · **Date:** 2026-07-13  
**Reviewer role:** District Collector/DM Process Expert + Revenue Administration Expert  
**Source branch:** `court-management-service` · repo at `/tmp/cms-wt`

> **Cross-ref:** D09 (§3) establishes the P0 org model blocker. This document assumes that DDL. D05 (`d05-admin-organogram.md §3`) and D23b (`d23b-identity-config-assessment.md §2`) are the authoritative sources for the org model gap; they are not re-analysed here.

---

## 1. Can SDM/Tehsil Offices Even Be Represented Today?

**Answer: NO. [VERIFIED] This is a P0 blocker for the entire document.**

[VERIFIED: `d05-admin-organogram.md §2`]

| Required entity | Table | In DB? | Evidence |
|---|---|---|---|
| Sub-division (administrative unit type) | `hierarchy.administrative_units` | **Schema-only; NOT migrated** | `civitas_location` DB has only `location.locations` table — `\dt` returns zero rows for `hierarchy.*` |
| Tehsil / Circle (administrative unit type) | Same | **Schema-only; NOT migrated** | Same |
| Unit type enum has `subdivision` or `tehsil` | `hierarchySchema.enum("unit_type")` | **ABSENT** | `location-service/src/modules/hierarchy/schema.ts:8-14` — enum values: `state, district, block, gp, ward, zone` — `subdivision`, `tehsil`, `mandal`, `taluk`, `firka`, `circle`, `village` are all missing |
| SDM office as an entity | `hierarchy.offices` | **Does not exist** | No `offices` table in any service |
| Tehsildar position | `hierarchy.positions` | **Does not exist** | — |
| Officer → Office posting with dates | `hierarchy.postings` | **Does not exist** | — |
| `officeId` in JWT / RequestContext | `packages/types/src/index.ts:71` | **ABSENT** | `RequestContext` has no `officeId` field |

**Consequence:** An SDM cannot be given jurisdiction over Sub-division A (and not B). A Tehsildar cannot be scoped to their tehsil's files. Every officer with `sdm_role` can see all SDM files in the tenant — there is no sub-division fence.

**To unblock this document's capabilities, three migrations must land first (sequentially):**
1. `location-service/migrations/0002_unit_types.sql` — replace PG enum with reference table, add `subdivision`, `tehsil`, `circle`, `mandal`, `taluk`, `village` (§8)
2. `location-service/migrations/0003_offices_positions_postings.sql` — from D09 §3
3. `identity-service` JWT enrichment — add `office_id`, `position_id`, `jur_unit_ids[]` claims from `hierarchy.postings` at login time

---

## 2. Terminology Configurability Assessment

**Is terminology hardcoded?**

[VERIFIED] Service code does NOT hardcode designation names in domain logic. The court-service uses `configKey` strings (`"sdm_court"`, `"tehsildar"`, `"collector_court"`) as config namespaces, not display labels. Labels come from config registry entries:

```typescript
// court-service/src/modules/config-registry/presets.ts [VERIFIED]
{ namespace: "court_type", configKey: "sdm_court", label: "Sub-Divisional Magistrate Court" },
{ namespace: "court_type", configKey: "tehsildar",  label: "Tehsildar Court" },
```

The `label` field in `court.config_entries` is the display string — it is per-tenant and overridable without code change.

[VERIFIED] `services/hrms-service/src/modules/employee/schema.ts` — `employee.hrms_designations` table stores designation name as `text` per tenant. No hardcoded `"SDM"` or `"Tehsildar"` string found in any service domain logic.

[VERIFIED ABSENT] Grep for hardcoded designation strings in service code: `grep -rn '"Collector"\|"DM"\|"SDM"\|"Tehsildar"\|"Mamlatdar"\|"MRO"\|"RDO"\|"BDO"' services/*/src --include="*.ts"` — **zero hits**.

**Verdict: Terminology is NOT hardcoded in code. [VERIFIED]**

However: the **unit_type PG enum** IS hardcoded at the DB level (`state, district, block, gp, ward, zone`). Changing this requires a DDL migration — it cannot be changed through config. See §8 for the fix.

**State-specific equivalences the platform must accommodate via config:**

| This platform's logical role | AP/Telangana | Maharashtra | UP | Tamil Nadu | Rajasthan | Odisha |
|---|---|---|---|---|---|---|
| Sub-Division Head | RDO | SDO/SD | SDM | Sub-Collector | SDM | SDM/RDO |
| Below Sub-Division | Mandal | Taluka | Tehsil | Taluk | Tehsil | Tahasil |
| Revenue Inspector | MRO | Circle Officer | Lekhpal | VAO | Patwari | RI |
| Panchayat level | Gram Panchayat | Gram Panchayat | Gram Panchayat | Village Panchayat | Gram Panchayat | Gram Panchayat |

All of these are the same level in the hierarchy tree; only the display label and the position_code differ. The fix (§8) makes `unit_type` a lookup table row, so adding `mandal` or `taluka` is an INSERT, not a migration.

---

## 3. Capability Assessment Table

| # | Capability | Mapped Service | Evidence | Verdict | Priority | Notes |
|---|---|---|---|---|---|---|
| 1 | Executive-magisterial workflows | workflow-service | `definitions/schema.ts` — generic BPMN; `definition_nodes.roleRef` | **Configurable (needs config)** | P1 | No Sec-144/Sec-107 templates exist; must be authored |
| 2 | Revenue court (mutation, partition, etc.) | court-service | `presets.ts` VERTICAL_PRESETS.revenue [VERIFIED] | **Configurable (needs config)** | P1 | Apply revenue preset; configure tehsildar/SDM court types |
| 3 | Mutation workflow | court-service | `case_parcels` table with khasra/khata/survey [VERIFIED] | **Requires-extension** | P1 | Case management exists; land records integration absent |
| 4 | Partition proceedings | court-service | case_type `partition` in revenue preset [VERIFIED] | **Configurable (needs config)** | P1 | — |
| 5 | Demarcation | — | No match in any service | **Requires-new-module** | P2 | Demarcation order workflow; outcome refs state survey dept |
| 6 | Encroachment detection/removal | — | No match in any service | **Requires-new-module** | P2 | Encroachment complaints + removal orders + recovery |
| 7 | Government land register | — | No match; `asset-service` covers movable/immovable govt assets | **Requires-extension** | P1 | Add govt-land module in asset-service (land survey no, nature of land, revenue records ref) |
| 8 | Revenue recovery | — | No match; court-service has `compliance_directions` | **Requires-new-module** | P1 | Demand certificate, attachment, distrain, warrant |
| 9 | Certificates (income, caste, domicile) | citizen-service | `citizen_applications` table; no service catalog | **Requires-extension** | P1 | Add service-catalog module (see D09 §2.17) |
| 10 | Public grievance / Jansunwai | citizen-service | Grievance CQRS with SLA [VERIFIED] | **Requires-extension** | P0 | CPGRAMS integration is a stub; office routing absent |
| 11 | RTI replies | citizen-service | `modules/rti/` full CQRS [VERIFIED: file listing] | **Configurable (needs config)** | P1 | Configure SIC/CPIO designation per state; RTI Act deadlines already coded |
| 12 | Disaster relief (SDM zone) | — | Zero grep hits | **Requires-new-module** | P0 | SDM coordinates tehsil-level relief; new disaster-service (see D09 §2.19) |
| 13 | Election work (BLO, micro-observer, Sec-144) | — | Zero grep hits | **Requires-new-module** | P1 | Workflow templates + ECI API adapter |
| 14 | Inspection (field/departmental) | — | Zero grep hits | **Requires-new-module** | P2 | — |
| 15 | Arms licence verification workflow | — | Zero grep hits in service domain | **Requires-new-module** | P1 | Police portal (SAMS) is system-of-record; this is verification-relay workflow |
| 16 | Procession/event permission | — | Zero grep hits | **Requires-new-module** | P1 | Sec-144 / permission order workflow; data in workflow-service |
| 17 | Enforcement coordination | — | Zero grep hits | **Requires-new-module** | P2 | — |
| 18 | Land records integration (state system) | — | Zero grep hits for DILRMP/Bhoomi/Dharitri | **Integrate-external-system** | P1 | **Must NOT duplicate RoR.** Adapter pattern only |
| 19 | eOffice / file movement | estab-service | `estab_files`, notings, DFA [VERIFIED] | **Fully-available** | — | — |
| 20 | HRMS (sub-divisional staff) | hrms-service | Full CQRS [VERIFIED] | **Requires-extension** | P1 | Missing posting/jurisdiction scoping |
| 21 | Finance / local accounts | finance-service | Budget demands, re-appropriation [VERIFIED] | **Requires-extension** | P1 | No SDM-unit-level budget view; treasury integration stub |
| 22 | Procurement (local) | procurement-service | GFR compliant [VERIFIED] | **Fully-available** | — | — |
| 23 | Assets (sub-divisional) | asset-service | 5 L2 modules [VERIFIED] | **Fully-available** | — | — |
| 24 | Workflow (general) | workflow-service | BPMN + delegation + DMN [VERIFIED] | **Fully-available** | — | Use for all magisterial workflows |
| 25 | Legal/court notices served by SDM | legal-service | `notices` module [VERIFIED] | **Configurable (needs config)** | P1 | Configure notice authority as SDM position |
| 26 | Scheme monitoring (MNREGS/PMAY etc.) | grant-service + project-service | 30+ tables [VERIFIED] | **Configurable (needs config)** | P1 | Configure scheme codes; project.location needs unit_id FK |
| 27 | Sub-division dashboard | analytics-service | Dashboards module [VERIFIED] | **Requires-extension** | P1 | No sub-division level KPI presets |

---

## 4. Revenue Court — What Works, What Needs Configuration, What Is Missing

### 4.1 What Works (court-service) [VERIFIED]

```
DB: civitas_court (22 tables)
✓ courts, benches — court/bench registry (courtType is config-driven)
✓ cases — case lifecycle state machine (filed→registered→admitted→pending→part_heard→reserved→disposed→appealed)
✓ case_parties — PII encrypted at rest (DPDP §4 compliant, AES-256-GCM)
✓ case_parcels — khasra/khata/survey/village/tehsil/district, area_sqm (bigint)
✓ hearings, cause_lists, cause_list_items — scheduling and cause list generation
✓ orders, certified_copies — order issuance with maker-checker
✓ appeals — revenue appeal chain (Tehsildar → SDM → DC → Board of Revenue)
✓ notices, notice_service — summons/notice issuance and service recording
✓ evidence — SHA-256 tamper-evidence for produced documents
✓ compliance_directions — compliance/execution monitoring
✓ public_establishments, otp_challenges — public case status lookup (OTP-gated)
✓ config_entries — all court/case/order types are config-driven, no hardcoding
```

### 4.2 Configuration Steps to Activate Revenue Vertical

```bash
# Step 1 — Apply revenue preset (idempotent, fans out court.config.set commands)
POST /v1/court/config/presets/apply
Body: { "preset": "revenue" }

# Step 2 — Register courts for each level
POST /v1/court/courts
Body: { "name": "Tehsildar Court, Tehsil-X", "courtType": "tehsildar",
        "jurisdiction": "tehsil_unit_id:UUID", "establishmentCode": "TH001" }

POST /v1/court/courts
Body: { "name": "SDM Court, Sub-Division-Y", "courtType": "sdm_court", ... }

POST /v1/court/courts
Body: { "name": "Collector Court, District-Z", "courtType": "collector_court", ... }

# Step 3 — Configure SLA timers per case type (Revenue Courts Act schedules vary by state)
POST /v1/court/config
Body: { "namespace":"sla_timer","configKey":"mutation","value":{"disposalDays":90} }
```

### 4.3 What Is Missing for Revenue Courts

| Gap | Impact | Required |
|---|---|---|
| Land records (RoR) integration | Mutation can be filed and adjudicated but the platform cannot verify/read the current khatauni/jamabandi from state system | Integrate-external-system: state land records API adapter (see §5) |
| Appeal hierarchy chain (Tehsildar → SDM → DC → Board of Revenue) | Appeal records exist but parentCourtId linkage to auto-route appeals is not wired | Config: set `parentCourtId` on each court at setup |
| Locking of land parcel during proceedings | Multiple cases can reference same khasra; no exclusive-lock mechanism | Requires-extension: add `court.case_parcel_locks` table |
| Demand/recovery after court order | Compliance directions exist but no flow to issue demand certificate or attach property | Requires-new-module: revenue recovery (§6) |
| Patwari circle officer assignment | No position type for field revenue staff | Config: add position_code `patwari`, `kanungo`, `ri` in hierarchy.positions |

---

## 5. Land Records: INTEGRATE, Do Not Re-Implement

**[VERIFIED ABSENT]** No land records adapter, table, or schema exists in the codebase. Grep for `DILRMP|Bhoomi|Dharitri|Bhulekh|Jamabandi|Bhu-Naksha|meri-fasal` returns zero hits.

**Statutory requirement:** State Revenue departments maintain RoR (Record of Rights) under state revenue codes (UP Revenue Code 2006, Maharashtra Land Revenue Code, Rajasthan Land Revenue Act, etc.). These are the authoritative systems of record. CivitasOne MUST NOT duplicate khasra/khatauni data.

**Required integration design:**

```typescript
// [PROPOSED] packages/gov-adapters/src/land-records/index.ts

export interface LandParcelSummary {
  surveyNo: string;
  khasraNo?: string;
  khataNo?: string;
  village: string;
  tehsil: string;
  district: string;
  areaSqm: number;
  ownerNames: string[];  // display only; not stored in CivitasOne
  landUseCode: string;
  lastMutationNo?: string;
  lastMutationDate?: string;
}

export interface LandRecordsAdapter {
  /**
   * Look up parcel details by survey/khasra number — READ ONLY.
   * Never store the returned PII in CivitasOne tables.
   */
  getParcel(
    surveyNo: string, village: string, tehsil: string, district: string,
    stateCode: string
  ): Promise<LandParcelSummary | null>;

  /**
   * After a mutation order is passed by the Revenue Court, notify the state
   * land records system to initiate the mutation — if the state provides an API.
   * Many states have no such API; the clerk records it manually.
   */
  notifyMutationOrder?(
    caseId: string, orderId: string, mutationType: string
  ): Promise<{ referenceNo: string } | null>;
}
```

**State-specific implementations:**
```typescript
// adapter registry (config-driven, not code-forked)
export const LAND_RECORDS_ADAPTERS: Record<string, () => LandRecordsAdapter> = {
  UP:  () => new BhulekhnAdapter(process.env.UP_BHULEKH_URL!),
  MH:  () => new BhomiAdapter(process.env.MH_MAHABHUMI_URL!),
  KA:  () => new BhoomiAdapter(process.env.KA_BHOOMI_URL!),
  AP:  () => new MeeSevaAdapter(process.env.AP_MEESEVA_URL!),
  // default: manual (adapter returns null → clerk must enter manually)
  DEFAULT: () => new ManualLandRecordsAdapter(),
};
```

**CivitasOne stores:** opaque `ownership_ref` (a state-issued RoR reference string) in `court.case_parcels.ownership_ref`. It never copies or caches owner names, pedigree tables, or khatauni data. This is consistent with DPDP §4 (purpose limitation) and removes the risk of stale data.

---

## 6. Revenue Recovery: New Module Required

**[VERIFIED ABSENT]** No revenue recovery capability exists. `court.compliance_directions` records compliance orders but does not model the revenue recovery process under state revenue codes (e.g., UP Revenue Code Ch. XV, Rajasthan Land Revenue Act s.202).

**Required new L2 module in court-service (or district-service):**

```sql
-- [PROPOSED] court-service (or new district-service) migration

CREATE TABLE revenue.recovery_demands (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  demand_no        TEXT NOT NULL,
  demand_type      VARCHAR(64) NOT NULL,  -- land_revenue, water_tax, cess, loan_recovery
  debtor_ref       TEXT NOT NULL,         -- opaque citizen/entity ref
  amount_minor     BIGINT NOT NULL,
  penalty_minor    BIGINT NOT NULL DEFAULT 0,
  interest_rate    NUMERIC(5,2),
  issued_by        UUID NOT NULL,         -- officer_id (Tehsildar/SDM)
  office_id        UUID NOT NULL,
  source_case_id   UUID,                  -- FK → court.cases (if arising from court order)
  status           VARCHAR(32) NOT NULL DEFAULT 'issued',
  -- state machine: issued→payment_received|coercive_initiated→attached→distrained→settled|waived
  ...standard cols...
);

CREATE TABLE revenue.coercive_actions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  demand_id     UUID NOT NULL,
  action_type   VARCHAR(64) NOT NULL,  -- attachment, distrain, warrant_of_arrest, auction
  ordered_by    UUID NOT NULL,
  ordered_at    TIMESTAMP WITH TIME ZONE,
  executed_at   TIMESTAMP WITH TIME ZONE,
  result        TEXT,
  ...standard cols...
);

CREATE TABLE revenue.recovery_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  demand_id     UUID NOT NULL,
  amount_minor  BIGINT NOT NULL,
  paid_at       TIMESTAMP WITH TIME ZONE,
  challan_ref   TEXT,
  mode          VARCHAR(32) NOT NULL DEFAULT 'challan',
  ...standard cols...
);
```

Events: `revenue.demand.issued`, `revenue.coercive.initiated`, `revenue.demand.settled` → audit-service.

---

## 7. Executive Magisterial Workflows: Configuration Required

[VERIFIED] `workflow-service` has a full BPMN engine with `definition_nodes`, SLA, deemed-approval, delegation, DMN decision tables. No executive-magisterial workflow templates exist.

**Required workflow definitions (to be seeded per tenant via workflow-service API):**

| Workflow | Trigger | Key steps | Authority |
|---|---|---|---|
| `sec_144_order` | Filed by police/SDM | Draft → SDM review → Legal opinion → Issue → Publish → Monitor | SDM |
| `sec_107_bond` | Filed by police | Notice → Hearing → Bond → Default (sec 117) | Executive Magistrate (SDM/DC) |
| `procession_permission` | Citizen application | Application → Police NOC → SDM order → Issue | SDM |
| `event_permission` | Citizen application | Application → Police NOC → SDM order → Issue with conditions | SDM |
| `removal_of_encroachment` | SDM/field report | Notice → Hearing → Order → Execution | SDM/Tehsildar |
| `arms_licence_noc` | Police SAMS trigger | Police verification → SDM endorsement → DC order | DC |
| `demolition_under_CrPC` | FIR/complaint | Notice → Hearing → Order | SDM/Magistrate |

These are authored as `workflow.definition` + `definition_nodes` + `definition_edges` via the workflow-service API — no code change required.

---

## 8. Unit Type Fix: DDL Required Before Any Sub-Division Can Be Represented

[VERIFIED: `location-service/src/modules/hierarchy/schema.ts:8-14`] Current PG enum: `state, district, block, gp, ward, zone`. Sub-division, tehsil, circle, mandal, taluk, village, firka are all absent.

**DDL for location-service migration `0002_unit_type_lookup.sql`:**

```sql
-- [PROPOSED] Replace the hardcoded PG enum with a per-tenant reference table

CREATE TABLE hierarchy.unit_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  code        VARCHAR(64) NOT NULL,            -- canonical code: subdivision, tehsil, village...
  display     TEXT NOT NULL,                   -- state-specific label (SDM / RDO / Mandal...)
  ordinal     INTEGER NOT NULL,                -- sort order in hierarchy (lower = higher in tree)
  is_system   BOOLEAN NOT NULL DEFAULT false,  -- system-defined types cannot be deleted
  UNIQUE (tenant_id, code)
);

-- Seed system defaults on tenant creation:
INSERT INTO hierarchy.unit_types (tenant_id, code, display, ordinal, is_system) VALUES
  (NEW.tenant_id, 'state',        'State',              10, true),
  (NEW.tenant_id, 'division',     'Division',           20, true),
  (NEW.tenant_id, 'district',     'District',           30, true),
  (NEW.tenant_id, 'subdivision',  'Sub-Division',       40, true),  -- SDM / RDO / SDO
  (NEW.tenant_id, 'tehsil',       'Tehsil',             50, true),  -- Taluk / Mandal / Tahasil
  (NEW.tenant_id, 'block',        'Block',              60, true),
  (NEW.tenant_id, 'circle',       'Revenue Circle',     65, true),  -- Patwari circle
  (NEW.tenant_id, 'gp',           'Gram Panchayat',     70, true),
  (NEW.tenant_id, 'ward',         'Ward',               70, true),
  (NEW.tenant_id, 'village',      'Village',            80, true),
  (NEW.tenant_id, 'zone',         'Zone',               25, true);

-- Alter administrative_units to use varchar instead of the enum:
ALTER TABLE hierarchy.administrative_units
  ALTER COLUMN type TYPE VARCHAR(64);

DROP TYPE hierarchy.unit_type;  -- drop the old PG enum
```

**After this migration**, adding `mandal` (Telangana), `taluka` (Maharashtra), `firka` (Tamil Nadu) is an INSERT into `hierarchy.unit_types` — no DDL, no code change, no deployment.

---

## 9. Blocking Gap Chain: Prerequisites for SDM/Tehsil

```
Migration 0001: location-service — hierarchy.administrative_units (already in code, run migration)
Migration 0002: location-service — unit_types lookup table (§8 above)
Migration 0003: location-service — offices, positions, postings (D09 §3)
identity-service: enrich JWT at login with office_id, position_id, jur_unit_ids from postings
packages/types: extend RequestContext with officeId, positionId, jurisdictionUnitIds
policy-service: add jurisdiction scope to permission evaluation
All services: add RLS policy: WHERE office_id = current_setting('app.office_id')::uuid
                         OR unit_id = ANY(current_setting('app.jur_unit_ids')::uuid[])
```

Until this chain completes, **no SDM/Tehsil office can be represented**, no file can be scoped to a sub-division, and no revenue court can be jurisdictionally isolated.

---

## 10. Integrate, Not Duplicate: External Statutory Systems

| External system | Role | Integration mode | What NOT to duplicate |
|---|---|---|---|
| State Land Records (Bhoomi/Bhulekh/Mahabhumi) | System-of-record for RoR | Read-only adapter (§5); store only opaque `ownership_ref` | Owner names, pedigree table, khatauni entries, mutation history |
| eCourts / NJDG | System-of-record for subordinate court proceedings | `legal-service/modules/ecourts/adapter.ts` [VERIFIED] — CNR lookup, circuit-breakered | Case diaries, FIR, charge-sheets — these are CCTNS/ICJS |
| PFMS | System-of-record for central scheme fund releases | `finance-service/src/shared/pfms.ts` — HoA/DDO validators [VERIFIED]; no outbound API adapter yet | Payment processing itself |
| CPGRAMS / PGPORTAL | National grievance system of record | Stub exists; implement `gov-adapters/cpgrams-adapter.ts` | Grievance content (only sync status + send replies) |
| ECI ERONET / NVSP | Voter roll system-of-record | Read-only booth lookup API | Voter names, EPIC numbers, addresses — DPDP risk |
| CCTNS / ICJS | Police case system-of-record | **Do NOT integrate from CivitasOne** | All FIR/investigation data — statutory restriction |

---

## 11. Summary: P0/P1 Actions Before District Pilot

| Priority | Action | Owner service | Type |
|---|---|---|---|
| P0 | Run `location-service` migrations for `administrative_units` (already coded) | location-service | Migration |
| P0 | Replace `unit_type` PG enum with `unit_types` lookup table; add subdivision/tehsil/circle/village | location-service | Migration |
| P0 | Create `offices`, `positions`, `postings` tables | location-service | Migration (new) |
| P0 | Enrich JWT with `office_id`, `position_id`, `jur_unit_ids` at login | identity-service | Extension |
| P0 | Implement CPGRAMS adapter for grievance sync | gov-adapters package | New |
| P0 | Add `assigned_office_id` + `jurisdiction_unit_id` to `citizen.grievances` | citizen-service | Schema extension |
| P1 | Apply revenue vertical preset; register courts for district | court-service | Config |
| P1 | Add government land register L2 module in asset-service | asset-service | New module |
| P1 | Add service-catalog L2 module in citizen-service | citizen-service | New module |
| P1 | Implement revenue recovery L2 module | court-service or district-service | New module |
| P1 | Seed Sec-144, Sec-107, procession-permission workflow definitions | workflow-service | Config/seed |
| P1 | Implement land records adapter (state-specific; adapter pattern) | gov-adapters package | New |
| P1 | Add `licensing-service` (arms, liquor, trade, explosive) | new service | New service |
| P1 | Add `disaster-service` (SDM/tehsil-level relief) | new service | New service |
| P1 | Fix `project.location` → `unit_id` FK for scheme monitoring | project-service | Schema extension |
| P2 | Demarcation workflow template + module | workflow-service + admin-service | Config + new |
| P2 | Encroachment removal workflow | workflow-service | Config |
| P2 | Inspection report module | admin-service or estab-service | New module |

---

*Evidence base: `services/court-service/src/modules/config-registry/presets.ts` (VERTICAL_PRESETS.revenue), `services/court-service/src/modules/case-parcel/schema.ts` (khasra/khata/survey fields), `services/location-service/src/modules/hierarchy/schema.ts:8-14` (unit_type enum), `docker exec civitasone-postgres psql -d civitas_location -c "\dt"` (hierarchy.* NOT migrated), `services/citizen-service/src/modules/helpdesk/domain.ts:1-2` (CPGRAMS stub), `services/legal-service/src/modules/ecourts/adapter.ts` (eCourts adapter, circuit-breakered), `d05-admin-organogram.md §2-3` (org model gap), `d23b-identity-config-assessment.md §2.1` (RequestContext gap), grep for hardcoded designations — zero hits.*
