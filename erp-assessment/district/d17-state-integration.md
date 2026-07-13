# D17 — Collector↔SP + District↔State Integration Assessment

**Lane:** L07 · **Date:** 2026-07-13  
**Reviewer role:** Enterprise Integration Architect + Government Domain Expert  
**Source branch:** `court-management-service` · repo at `/tmp/cms-wt`

> **HARD PREREQUISITE — READ FIRST:** The org model today is `Tenant → Department → User`. There is no office, position, posting, or jurisdiction entity in the live database. [`d05-admin-organogram.md §2`, verified: `services/location-service/src/modules/hierarchy/schema.ts` — code only, `civitas_location` DB has zero hierarchy/jurisdiction tables; `packages/types/src/index.ts:71` — `RequestContext` carries no `officeId/positionId/jurisdictionId`]. **Every Collector↔SP workflow requires office-scoped actors. All 16 workflows below are BLOCKED until the org model (L02, d05) ships.** Mark all as P0-blocked.

---

## §1 — Collector↔SP Workflow Integration Table

**Status of entire domain:** [VERIFIED] No coordination-service exists. `grep -rln "collector\|superintendent\|law.and.order\|disaster\|magistrate" services --include="*.ts"` returns only visitor-service (emergency evacuation), meeting-service (general), and court-service (court orders). Zero Collector↔SP protocol is modelled today.

Every row below is [PROPOSED].

| # | Workflow | Owning Authority | Trigger | Data Shared | Data NOT Shared | Approval Responsibility | Mechanism | Classification | Audit | Retention | Escalation | Failure Handling |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Law-and-order planning | District Magistrate (DM) | Weekly/event-driven cadence | Threat assessment, area of concern, deployment requirement count | Intelligence reports, CCTNS data, criminal profiles, surveillance feeds | DM issues written order; SP acknowledges | async event `district.laworder.plan.created.v1` → SP office queue | CONFIDENTIAL | Full audit trail on issue+acknowledgement | 5 years | Auto-escalate to Divisional Commissioner if SP non-acknowledgement >24h | DLQ + notification to DM office; manual intervention |
| 2 | Public-event permission | Sub-Divisional Magistrate (SDM) | Citizen/organiser application via citizen-service | Event details, venue, estimated crowd, route, date/time | Organiser PII beyond contact, internal intelligence | SDM grants/refuses; SP provides security assessment input | sync API `POST /v1/coordination/event-permissions` with SP consultation callback | INTERNAL | Permission record + SP assessment + SDM order | 3 years | DM if SDM declines appeal; High Court if writ filed | citizen-service application status → PENDING_SP_CLEARANCE; timeout 48h → auto-escalate |
| 3 | Festival/religious event | DM (large events) / SDM (local) | Calendar-driven + application | Venue, religious body, expected footfall, VIP/VVIP presence | Intelligence assessment | DM/SDM issues permission; SP issues deployment order | event `district.festival.clearance.issued.v1` → police-coordination topic | CONFIDENTIAL (VVIP presence field) | Clearance + deployment order + post-event report | 3 years | Commissioner of Police / Range DIG if cross-district | Pre-event checklist failure → block issuance; notify both offices |
| 4 | Procession/rally | DM | Organiser application + police NOC | Route, timing, organiser undertaking, no-objection from SP | Route clearance intelligence basis | DM issues Section 30 CrPC permission; SP provides traffic + security plan | sync `POST /v1/coordination/procession-permissions` + event on approval | RESTRICTED | Permission order + SP letter + route map (GIS attachment) | 3 years | DM → Divisional Commissioner if situation deteriorates | SP NOC timeout 48h → auto-notify DM; hold permission |
| 5 | Disaster response | DM (Incident Commander) | Incident declaration event from SDMA/DM | Incident type, affected area (geo-polygon), population at risk, resource requirement | Casualty data before next-of-kin notification, ongoing rescue ops details | DM is Incident Commander; SP is Force Commander under DM for law-and-order | event `disaster.incident.declared.v1` (DM) + `district.police.force.requisitioned.v1` (SP) | RESTRICTED → CONFIDENTIAL post-normalisation | Every resource deployment, casualty record, relief disbursement | 7 years | SDMA if district resources exhausted; NDMA via State EOC | Idempotent disaster record; duplicate declaration rejected with 409 |
| 6 | Election deployment | DEO (District Election Officer, typically DM) | ECI schedule notification + district election plan | Booth-wise deployment requirement, sensitive booth list, route plan | Intelligence assessment, vulnerability map | DEO issues model code enforcement order; SP issues deployment order | event `election.deployment.plan.created.v1`; SP consumption mandatory | RESTRICTED | All election deployment records permanently | Permanent (Election Commission mandate) | CEO (Chief Electoral Officer) if district resources insufficient | SP non-acknowledgement within 4h → auto-escalate to CEO portal |
| 7 | Arms licence verification | DM (licensing authority under Arms Act) | Renewal/new application; SP background check requirement | Applicant reference ID, licence category requested | Criminal record details (only final verdict: clear/adverse) | DM issues licence after SP clearance | sync `GET /v1/coordination/arms/clearance/{applicantRef}` (SP → DM) + event on grant | RESTRICTED | Full application audit with SP response hash | 10 years | Session Court if DM refuses and applicant appeals | SP clearance timeout 30 days → licence deemed pending; DM manual review |
| 8 | Land/encroachment enforcement | DM/SDM (revenue authority) | Revenue court order / Collector's order | Survey number, encroachment extent, revenue record reference | Detailed ownership disputes, pending litigation | DM/SDM issues eviction order; SP provides force for eviction | event `revenue.eviction.order.issued.v1` → SP requisition | RESTRICTED | All orders permanently (land records are permanent) | Board of Revenue if disputed | Revenue court order verification; SP to confirm force availability before execution |
| 9 | Public grievance (escalation) | DM (district CPGRAMS nodal) | citizen-service `citizen.grievance.escalated.v1` | Grievance ID, department tag, escalation reason | Grievant PII (visible only to assigned officer with DPDP consent) | DM reviews; may direct SP if public-safety element | event `citizen.grievance.escalated.v1` → coordination.grievance.district.assigned.v1 | INTERNAL | Grievance lifecycle complete audit | 5 years (CPGRAMS mandate) | Chief Minister's helpline / CPGRAMS state portal | SLA timer: 7 days → auto-escalate to Divisional Commissioner |
| 10 | Missing person↔disaster linkage | SP (missing persons) + DM (disaster roster) | `disaster.incident.declared.v1` + `police.missing_person.registered.v1` | Common reference: incident_id + geo-polygon; positive match notification | Investigation details, CCTNS case data | SP verifies missing → disaster linkage; DM updates relief roster | event-join: `district.missing_person.disaster_linked.v1` on match | RESTRICTED | Linkage event with both references | 5 years | SDMA family assistance cell | Auto-delink if person found; idempotent linkage |
| 11 | Emergency control room | DM (District EOC) + SP (District Police Control Room) | `disaster.incident.declared.v1` or manual activation | EOC activation status, resource board, helpline numbers | Tactical operations, intelligence | Dual command: DM for civil, SP for law-and-order | real-time event stream `district.eoc.status_updated.v1` (pub/sub pattern, Redis Streams) | RESTRICTED | All EOC activations + deactivations | 7 years | State EOC (SDMA) | Fallback to telephony-service if event bus unavailable; SMS gateway |
| 12 | Executive magistrate deployment | DM | SP request for exec magistrate under Section 144 / 130 CrPC | Deployment location, duration, incident reference, powers required (Section 144/130/144A) | Intelligence basis for request | DM authorises; designated executive magistrate deployed | event `district.exec_magistrate.deployed.v1` → SP consumed | RESTRICTED | Deployment order + duration + powers with timestamp | 10 years | High Court if Section 144 challenged | DM must confirm in writing within 2h of verbal order; event carries written order reference |
| 13 | Police force requisition | Any district authority → SP | Formal written requisition | Requisition number, purpose, strength required, duration, officer-in-charge | Tactical deployment details | SP acknowledges; DM countersigns for large-scale deployment | event `district.police.force.requisitioned.v1` + sync `POST /v1/coordination/force-requisitions` | RESTRICTED | All requisitions with outcome | 5 years | Range DIG if SP cannot meet requisition | SP to respond within 4h; timeout → auto-notify DM + Divisional Commissioner |
| 14 | Traffic/route coordination | SP Traffic / DM | Event permission, VIP movement, road works NOC | Route, time window, diversion plan | VIP identity in transit (restricted) | SP issues traffic advisory; DM co-signs for VVIP | event `district.traffic.route_advisory.issued.v1` → ULB/transport | RESTRICTED (VVIP field) | All route advisories | 3 years | Commissioner of Police for metro areas | GIS integration required; deconflict with other events on same route |
| 15 | Incident closure + AAR | DM (civil) + SP (law-and-order) | Joint decision post-normalisation | Incident summary, casualties, relief disbursed, FIR count | Investigation details, forensics | Joint DM + SP sign-off on closure | event `district.incident.closed.v1` with both signatures | CONFIDENTIAL → INTERNAL after 30 days | Permanent | State Government for major incidents | Closure blocked if open FIRs above threshold; auto-notify State Home |
| 16 | After-action review | DM convenes, SP attends | Post-closure (D+7 from incident closure) | All resource deployment records, timeline, lessons-learned document | Intelligence findings (SP submits separately to DIG) | DM finalises report; copy to Divisional Commissioner | event `district.aar.submitted.v1` with report attachment ref | INTERNAL | Report + all referenced records | 5 years | Divisional Commissioner if recommendations require state resources | Reminder at D+5 if AAR not initiated |

---

## §2 — Coordination Domain: New Service Required

[PROPOSED] None of the above exists. A new `coordination-service` is required with:

```
services/coordination-service/src/modules/
  event-permissions/     -- workflows 2, 3, 4
  force-requisitions/    -- workflows 13, 12
  disaster/              -- workflows 5, 10, 11, 15, 16
  elections/             -- workflow 6
  incident/              -- workflows 1, 8, 14
  licensing/             -- workflow 7
  grievance-routing/     -- workflow 9
```

**Prerequisite graph:**
```
P0: Org Model (office + position + posting) ← d05 L02
  └─ P0: coordination-service
       ├─ P0: CCTNS adapter (FIR read-only via ICJS/CCTNS API, NO duplicate data)
       ├─ P0: disaster module (SDRF flows)
       └─ P1: election module (ECI API integration)
```

**Key Schema DDL [PROPOSED]:**
```sql
-- coordination-service: schema coordination
CREATE TABLE coordination.force_requisitions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  requisition_no    TEXT NOT NULL,
  requesting_office UUID NOT NULL,        -- FK → hierarchy.offices
  sp_office         UUID NOT NULL,        -- FK → hierarchy.offices
  purpose           VARCHAR(32) NOT NULL, -- election|disaster|event|enforcement
  incident_ref      TEXT,                 -- opaque "disaster:UUID"
  strength_required INTEGER NOT NULL,
  duration_hours    INTEGER,
  status            VARCHAR(24) NOT NULL DEFAULT 'pending',
  sp_acknowledged_at TIMESTAMPTZ,
  dm_countersigned_at TIMESTAMPTZ,
  correlation_id    VARCHAR(64) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID NOT NULL,
  updated_by        UUID NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1
);
```

---

## §3 — District↔State Reporting Chains

**Current status:** [VERIFIED] No hierarchical reporting chain exists. There is no divisional commissioner office, no state secretariat tenant, no inter-tenant event bus. All 38 services use single `tenantId` with no parent-child tenant relationship.

**Required chains (all [PROPOSED]):**

### 3.1 Civil Administration Chain
```
Collector (District) 
  → Divisional Commissioner (Division)
    → Department Secretariat (State HQ)
      → Chief Secretary Office
        → Ministry/GoI (if CSS scheme)
```

### 3.2 Police Chain
```
Station House Officer (SHO)
  → Circle Inspector / SDPO
    → SP (District)
      → DIG (Range/Zone)
        → ADGP / IGP
          → DGP
            → State Home Department
              → MHA (GoI for law & order)
```

### 3.3 Line Department Chain
```
Block-level officer (BDO / extension officer)
  → Tehsil / Sub-Division office
    → District-level line dept office (e.g., CDHO, DIO, DPRO)
      → Regional Directorate
        → Directorate (State HQ)
          → Principal Secretary / Secretary
            → Ministry (GoI for centrally-sponsored schemes)
```

### 3.4 Implementation Requirements

All hierarchical reporting chains require in order:

1. **P0 — Org Model:** `hierarchy.offices`, `hierarchy.positions`, `hierarchy.postings`, `hierarchy.administrative_units` migrated to DB [currently code-only in location-service, d05 §4]
2. **P0 — Multi-tier Tenancy:** parent-child tenant relationships or cross-tenant federation with controlled data aggregation [currently: flat single-tier, d08-tenant-isolation-report.md]
3. **P1 — Reporting Service extension:** `report-service` must support parameterised aggregation by `officeId`, `jurisdictionId`, `govLevel` — not just `tenantId`
4. **P1 — Approval chain config:** workflow-service approval chains must resolve via position hierarchy, not hardcoded user lists
5. **P2 — State Data Exchange:** NIC/state SDC integration for pushing aggregated reports upstream (PFMS, e-Sampada, state MIS portals)

**State-Dependency Statement:** _Until §3.4 items 1 and 2 are complete, no district-to-state data flow is technically possible. P0 org model work must precede all integration in this file._

---

## §4 — Priority Register

| ID | Finding | Priority | Blocker? |
|---|---|---|---|
| D17-01 | No coordination-service; all 16 Collector↔SP workflows absent | P0 | Yes — district pilot impossible |
| D17-02 | Org model (office/position/jurisdiction) not in DB — blocks all office-scoped events | P0 | Yes |
| D17-03 | No parent-child tenant model for district→state aggregation | P0 | Yes |
| D17-04 | CCTNS/ICJS read-only adapter absent; police-collector linkage impossible | P0 | Yes |
| D17-05 | All 16 coordination event topics undefined (not in any topics.ts) | P0 | Yes |
| D17-06 | Disaster module missing (SDRF fund release, victim registration, relief rosters) | P0 | Yes |
| D17-07 | Election coordination module missing | P1 | Before rollout |
| D17-08 | Reporting chain config: report-service has no `govLevel`/`officeId` grouping | P1 | Before rollout |
| D17-09 | Arms licence module missing (DM as licensing authority) | P1 | Before rollout |
| D17-10 | After-action-review module missing | P2 | Before state rollout |

---

*Cross-references: d05 (org model), d09 (collectorate gaps), d10 (police gaps), d06 (police organogram), d19 (event catalogue), d20 (integration matrix)*
