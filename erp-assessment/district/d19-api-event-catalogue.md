# D19 — API/Event Catalogue + Integration Gateway Assessment

**Lane:** L07 · **Date:** 2026-07-13  
**Reviewer role:** Enterprise Integration Architect + Event-Driven Architecture Expert  
**Source branch:** `court-management-service` · repo at `/tmp/cms-wt`

---

## §1 — Current Event Envelope: Verified Fields

[VERIFIED: `packages/events/src/envelope.ts:14-24`]

```typescript
// Current envelope — enforced by zod at consume boundary
{
  messageId:     string (UUID)        // ✅ required
  type:          string               // ✅ required
  tenantId:      string               // ✅ required
  actorId:       string               // ✅ required
  correlationId: string               // ✅ required
  causationId:   string (optional)    // ✅ present but optional
  timestamp:     string (ISO 8601)    // ✅ required
  schemaVersion: string               // ✅ required (but all producers hardcode "1.0" — 07-integration-matrix.md §1.2)
  payload:       unknown              // ✅ type-guarded by service
}
```

[VERIFIED: `packages/outbox/src/index.ts:36-46`] — Outbox table columns:
```
id, topic, eventType, tenantId, actorId, correlationId, payload, createdAt, publishedAt
```

**Fields MISSING from current envelope for a district governance platform:**

| Missing Field | Why Required | Impact if Absent |
|---|---|---|
| `officeId` | Events cross office boundaries (Collector→SP, SDM→DM) | Cannot route events to correct office queue; all events are tenant-scoped only |
| `jurisdictionId` | Geo-scoping for disaster, election, law-and-order events | No way to filter events by geography; district platform impossible |
| `govLevel` | Distinguish district / state / ministry event scope | Cross-level federation impossible; no routing by level |
| `district` (LGD code) | Standard govt identifier for district | Cannot correlate with NIC/LGD/PFMS/CCTNS district codes |
| `state` (ISO 3166-2 code) | State identifier for federation | Ministry aggregation has no state filter |
| `department` | Owning department of the event | Multi-department district (civil+police+health+education) has no routing dimension |
| `classification` | RESTRICTED/CONFIDENTIAL/INTERNAL/PUBLIC | No classification-based filtering; all data treated identically |
| `retentionPolicy` | Different events have 3y/5y/7y/permanent | Audit retention is uniform 180d — insufficient for legal/revenue/election records |

---

## §2 — Proposed Government Event Envelope

[PROPOSED] The current envelope must be extended. Existing consumers MUST tolerate additional fields (additive, not breaking). New fields are **optional at schema level** but **required by district-platform consumers**.

```typescript
// Target envelope — backwards-compatible extension of current envelope
interface GovEventEnvelope<T> {
  // ── Existing fields (unchanged) ──────────────────────────────
  messageId:     string;           // UUID, globally unique
  type:          string;           // e.g. "district.laworder.plan.created.v1"
  tenantId:      string;           // issuing tenant UUID (district office)
  actorId:       string;           // UUID of acting officer
  correlationId: string;           // UUID, spans all hops
  causationId?:  string;           // UUID of triggering event (parent in chain)
  timestamp:     string;           // ISO 8601 UTC
  schemaVersion: string;           // semantic version "1.0", "2.0"
  payload:       T;                // domain payload (typed per event)

  // ── New fields (all optional for backward compat; required for district platform) ──
  officeId?:     string;           // UUID → hierarchy.offices (issuing office)
  jurisdictionId?: string;         // UUID → hierarchy.jurisdictions
  govLevel?:     'village'|'block'|'panchayat'|'tehsil'|'subdivision'|'district'
               | 'division'|'state'|'ministry'|'central';
  district?:     string;           // LGD district code (6-digit)
  state?:        string;           // ISO 3166-2:IN state code (e.g. "IN-UP")
  department?:   string;           // opaque "department:UUID" or configured dept code
  classification?: 'PUBLIC'|'INTERNAL'|'RESTRICTED'|'CONFIDENTIAL'|'SECRET';
  retentionPolicy?: '1y'|'3y'|'5y'|'7y'|'10y'|'permanent';
  purposeCode?:  string;           // DPDP §3: declared processing purpose
}
```

**Migration strategy:** Update `packages/events/src/envelope.ts` — add optional fields to `eventEnvelopeSchema` with `.optional()`. All current producers continue to compile. District-platform consumers add validation guards: `if (!env.district) throw NonRetryableError('missing district code')`.

---

## §3 — Government Event Catalogue

All entries below are [PROPOSED] unless marked [VERIFIED]. Envelope fields shown are additions to the existing base envelope.

### 3.1 District Coordination Events

| Event Type | Version | Owner Service | Trigger | Key Payload Fields | Classification | Retention | Consumers |
|---|---|---|---|---|---|---|---|
| `district.laworder.plan.created.v1` | 1 | coordination-service | DM submits weekly plan | `{planId, period, areaOfConcern[], deploymentRequired, incidentRef?}` | CONFIDENTIAL | 5y | sp-coordination queue |
| `district.laworder.plan.acknowledged.v1` | 1 | coordination-service | SP acknowledges | `{planId, acknowledgedAt, remarks?}` | CONFIDENTIAL | 5y | dm-office queue |
| `district.event_permission.granted.v1` | 1 | coordination-service | SDM issues permission | `{permissionId, eventType, venue, dateRange, crowd, spClearanceRef}` | INTERNAL | 3y | citizen-service, notification |
| `district.event_permission.refused.v1` | 1 | coordination-service | SDM refuses | `{permissionId, reason, appealDeadline}` | INTERNAL | 3y | citizen-service, notification |
| `district.exec_magistrate.deployed.v1` | 1 | coordination-service | DM deploys under CrPC | `{deploymentId, officerId, powers[], location, duration, incidentRef}` | RESTRICTED | 10y | hr-update queue, audit |
| `district.police.force.requisitioned.v1` | 1 | coordination-service | Any authority → SP | `{requisitionId, requisitioningOfficeId, spOfficeId, purpose, strength, duration}` | RESTRICTED | 5y | sp-coordination, dm-office |
| `district.police.force.deployed.v1` | 1 | coordination-service | SP confirms deployment | `{requisitionId, actualStrength, officerInCharge, deployedAt}` | RESTRICTED | 5y | dm-office, audit |
| `district.traffic.route_advisory.issued.v1` | 1 | coordination-service | SP Traffic issues advisory | `{advisoryId, routeGeoJson, timeWindow, reason, diversions[]}` | RESTRICTED | 3y | ulb-service, notification |
| `district.incident.closed.v1` | 1 | coordination-service | Joint DM+SP closure | `{incidentId, closedAt, casualties, reliefDisbursed, openFirCount, dmSignRef, spSignRef}` | CONFIDENTIAL | permanent | audit, state-home |
| `district.aar.submitted.v1` | 1 | coordination-service | DM submits AAR | `{incidentId, reportRef, lessonsLearned[], recommendations[]}` | INTERNAL | 5y | divisional-commissioner, analytics |

### 3.2 Disaster Management Events

| Event Type | Version | Owner Service | Key Payload Fields | Classification | Retention |
|---|---|---|---|---|---|
| `disaster.incident.declared.v1` | 1 | coordination-service | `{incidentId, type, affectedArea:{geoPolygon,lgdCodes[]}, severity, population, dmOfficeId}` | RESTRICTED | 7y |
| `disaster.incident.escalated.v1` | 1 | coordination-service | `{incidentId, from:govLevel, to:govLevel, reason, resourcesExhausted[]}` | RESTRICTED | 7y |
| `disaster.resource.deployed.v1` | 1 | coordination-service | `{incidentId, resourceType, quantity, deployedFrom, deployedTo, officerId}` | RESTRICTED | 7y |
| `disaster.relief.disbursed.v1` | 1 | coordination-service | `{incidentId, beneficiaryCount, amountMinor, currency, schemeRef}` | RESTRICTED | 7y |
| `disaster.missing_person.registered.v1` | 1 | coordination-service | `{missingId, incidentId?, name, age, lastSeen:{location,timestamp}, reportedBy:officeId}` | CONFIDENTIAL | 5y |
| `disaster.missing_person.disaster_linked.v1` | 1 | coordination-service | `{missingId, incidentId, linkedAt}` | RESTRICTED | 7y |
| `disaster.eoc.activated.v1` | 1 | coordination-service | `{eocId, incidentId, activatedBy:officeId, helplines[]}` | RESTRICTED | 7y |

### 3.3 Police Coordination Events (NO CCTNS DUPLICATION)

**Rule:** Police events in CivitasOne are coordination/requisition events only. FIR registration, case diary, charge sheet, investigation progress — these are CCTNS/ICJS system-of-record. CivitasOne must only receive notification/reference events from CCTNS via approved adapter, never replicate criminal investigation data.

| Event Type | Version | Owner | Key Payload Fields | Note |
|---|---|---|---|---|
| `police.assistance.requested.v1` | 1 | coordination-service | `{requestId, fromOfficeId, purpose, location, urgency}` | Coordination only — no FIR data |
| `police.assistance.provided.v1` | 1 | coordination-service | `{requestId, providedAt, officerRef}` | |
| `police.missing_person.registered.v1` | 1 | coordination-service | `{missingId, cctnsRef?, name, age}` | `cctnsRef` is opaque — no case data |
| `police.missing_person.found.v1` | 1 | coordination-service | `{missingId, foundAt, circumstances}` | |
| `police.arms_clearance.provided.v1` | 1 | coordination-service | `{applicantRef, verdict:clear|adverse, validUntil}` | No criminal record details |
| `police.arms_clearance.refused.v1` | 1 | coordination-service | `{applicantRef, reason:opaque}` | Reason is policy code, not criminal data |

### 3.4 Scheme/Ministry Events

| Event Type | Version | Owner | Key Payload Fields | Classification | Retention |
|---|---|---|---|---|---|
| `scheme.scheme_master.created.v1` | 1 | scheme-registry | `{schemeId, code, govLevel, ownerId, fundingAuthorityId, fundingPattern}` | INTERNAL | permanent |
| `scheme.guideline.issued.v1` | 1 | scheme-registry | `{schemeId, guidelineVersion, documentRef, effectiveDate}` | INTERNAL | permanent |
| `scheme.target.allocated.v1` | 1 | scheme-registry | `{schemeId, officeId, period, physicalTarget, financialTargetMinor}` | INTERNAL | 5y |
| `scheme.fund.released.v1` | 1 | scheme-registry | `{schemeId, installmentNo, amountMinor, pfmsRef, fromAuthorityId, toOfficeId}` | RESTRICTED | 10y |
| `scheme.progress_report.submitted.v1` | 1 | report-service | `{schemeId, officeId, period, physicalPct, utilisedMinor, beneficiaryCount}` | INTERNAL | 5y |
| `scheme.uc.validated.v1` | 1 | grant-service | `{ucId, schemeId, period, validatedBy, remarks?}` | RESTRICTED | 10y |
| `scheme.uc.rejected.v1` | 1 | grant-service | `{ucId, schemeId, reason}` | RESTRICTED | 10y |
| `scheme.audit_observation.raised.v1` | 1 | audit-service | `{paraId, schemeId, paraNo, amountMinor, auditType}` | CONFIDENTIAL | 10y |
| `scheme.compliance_response.submitted.v1` | 1 | grant-service | `{paraId, response, attachmentRef}` | CONFIDENTIAL | 10y |
| `scheme.beneficiary.aggregated.v1` | 1 | report-service | `{schemeId, period, total, categoryBreakdown}` (NO PII) | INTERNAL | 5y |

### 3.5 Existing Events Extended with District Fields

These exist today [VERIFIED: `services/citizen-service/src/topics.ts`, `services/grant-service/src/topics.ts`]. They need envelope enrichment only:

| Existing Event | Extension Required |
|---|---|
| `citizen.grievance.escalated.v1` | Add `officeId`, `jurisdictionId`, `district` to envelope |
| `citizen.grievance.resolved.v1` | Add same fields |
| `citizen.rti.filed.v1` | Add `department`, `district` |
| `grant.uc.submitted` | Add `schemeId` (scheme_master_id), `district`, `officeId` |
| `grant.disbursement.completed` | Add `schemeId`, `pfmsRef`, `district` |
| `project.physical_progress.recorded` | Add `schemeId`, `officeId`, `district` |
| `court.case.registered` | Add `jurisdictionId`, `district` |
| `audit.event.record` | Add `officeId`, `classification` |

### 3.6 Grievance / RTI / Citizen Escalation Events

| Event Type | Version | Key Payload | Retention |
|---|---|---|---|
| `grievance.escalated.v1` | 1 | `{grievanceId, fromOfficeId, toOfficeId, reason, slaBreachedAt}` | 5y |
| `grievance.district_assigned.v1` | 1 | `{grievanceId, officeId, assignedOfficerId, deadline}` | 5y |
| `grievance.cross_district.transferred.v1` | 1 | `{grievanceId, fromDistrictId, toDistrictId}` | 5y |
| `inspection.noncompliance.created.v1` | 1 | `{inspectionId, entityType, entityId, violations[], deadlineForRemediation}` | 5y |

---

## §4 — Integration Gateway Assessment

### 4.1 Current Gateway Capabilities

[VERIFIED: `services/gateway-service/src/app.ts`]

| Capability | Status | Evidence |
|---|---|---|
| JWT verification (edge) | ✅ PRESENT | `jwtEdgeVerify` preHandler |
| API key authentication | ✅ PRESENT | `apiKeyPreHandler` |
| Global rate limiting (Redis-backed) | ✅ PRESENT | `@fastify/rate-limit` + `REDIS_URL` |
| Per-tenant rate limiting | ✅ PRESENT | second tier, key=`x-tenant-id` |
| Per-tenant quota enforcement | ✅ PRESENT | `quotaCheckPlugin` from `@civitasone/db` |
| Module guard (entitlement enforcement) | ✅ PRESENT | `checkModuleEnabled` |
| ABAC policy enforcement | ✅ PRESENT | `checkPolicy` → policy-service |
| Circuit breaker per upstream | ✅ PRESENT | `proxyFetch` with `getBreakerStates()` |
| CORS + Helmet (CSP, HSTS, X-Frame) | ✅ PRESENT | `@fastify/cors` + `@fastify/helmet` |
| Body size limit (1MB) | ✅ PRESENT | `bodyLimit: 1_048_576` |
| Correlation ID propagation | ✅ PRESENT | `x-correlation-id` forwarded |
| Response streaming | ✅ PRESENT | Node.js Readable pipe |
| Schema registry (payload validation) | ❌ MISSING | `validatePayload()` not called at gateway — 07-integration-matrix.md §1.2 |
| mTLS (service-to-service) | ❌ MISSING | Only `x-internal-secret` header |
| Digital signatures on events | ❌ MISSING | No DSC/PKI for outbound events |
| Protocol conversion | ❌ MISSING | HTTP only; no SOAP, ISO 8583, state SDE |
| Payload transformation / field filtering | ❌ MISSING | Proxy passes body verbatim |
| Classification-based filtering | ❌ MISSING | No `classification` header check |
| Purpose enforcement (DPDP §3) | ❌ MISSING | No purpose-code validation |
| Replay protection (nonce/timestamp) | ❌ MISSING | idempotency key passed through but not enforced at gateway |
| Sandbox environment routing | ❌ MISSING | No sandbox flag; dev/prod share same gateway config |
| `officeId`/`jurisdictionId` injection | ❌ MISSING | Gateway does not enrich forwarded headers with office context |
| `govLevel` routing | ❌ MISSING | No gov-level based upstream selection |

### 4.2 Government Integration Gateway: Additional Requirements

[PROPOSED] A **Government Integration Gateway (GIG)** layer is needed between the current API gateway and external statutory systems. The current gateway handles internal service routing. GIG handles external government API federation.

```
                     ┌─────────────────────────────────────────────┐
Client/Officer       │           Current API Gateway               │
   ──────────────────►  JWT / rate-limit / module-guard / policy   │
                     │  circuit-breaker / correlation-id            │
                     └────────────────┬────────────────────────────┘
                                      │ internal services
                     ┌────────────────▼─────────────────────────────────────────┐
                     │           Government Integration Gateway (PROPOSED)       │
                     │  schema-registry / transformation / classification-filter │
                     │  purpose-enforcement / mTLS / digital-signatures          │
                     │  replay-protection / sandbox routing / DLQ                │
                     └──────────────────────────────────────────────────────────┘
                         │          │          │          │          │
                     CCTNS/ICJS  PFMS     DigiLocker   IFMS/Treasury  NIC-SDX
                     (read-only) (fund)   (doc verify)  (payment)   (state SDE)
```

### 4.3 Required Standard Government Adapters

All entries below are [PROPOSED] / [MISSING] unless noted.

| Adapter | Integration Point | Protocol | Direction | Data | Priority |
|---|---|---|---|---|---|
| **CCTNS/ICJS** | FIR reference, case status (read-only) | REST (ICJS API) + mTLS | Inbound pull | FIR number, case status, accused bail status — NO case diary/evidence | P0 |
| **PFMS** | Fund release tracking, UC submission | PFMS Public API v3 + OAuth2 | Bidirectional | GOO/sanction nos, fund releases, UC status | P0 |
| **DigiLocker** | Document verification | DigiLocker Gateway API + PKI | Inbound pull | Document URI, issuer signature verification | P1 [visitor-service has stub adapter — NOT connected to govt gateway] |
| **State Treasury / IFMS** | Payment/receipt reconciliation | State-specific (varies); typically SOAP + HTTPS mutual auth | Bidirectional | Challan, payment order, receipt | P0 |
| **eOffice (NIC)** | File/noting exchange with higher offices | eOffice API (NIC) | Bidirectional | File reference, noting, DFA | P1 |
| **State Data Exchange (NIC-SDX/NDAP)** | Cross-department data sharing | REST + OAuth2 + signed JWT | Bidirectional | Aggregated reports, scheme MIS | P1 |
| **GIS / Bhuvan / State GIS** | Geo-tagging, boundary verification | OGC WFS/WMS + REST | Inbound pull | Geo-polygons, LGD codes, survey numbers | P1 |
| **Payment Gateways (BBPS/UPI/NeGP)** | Citizen fee payment | NACH adapter exists (payroll); BBPS/UPI absent | Inbound | Payment confirmation, UTR | P0 |
| **Aadhaar eKYC (UIDAI)** | Beneficiary identity verification | AUA API + HMAC | Inbound | Verification result (DPDP §4 — no raw Aadhaar storage) | P0 — visitor-service has stub |
| **CPGRAMS** | Grievance federation to national portal | CPGRAMS REST API | Bidirectional | Grievance ID, status, response | P1 |
| **NIC Notification Gateway** | SMS/email via state channels | NIC MSG91/SMS API | Outbound | SMS, email (notification-service partially covers) | P1 |
| **Ministry Scheme Platforms** | PMAY, MGNREGS, PM-KISAN, etc. | Per-ministry API (varied) | Bidirectional | Progress, beneficiary counts, UC | P2 |
| **MCA21 / GST** | Business/vendor registration verification | REST + DSC | Inbound pull | Registration status, GSTIN verification | P2 |
| **NeSDA** | National e-Governance Architecture compliance | OpenAPI 3.0 | Outbound | Service catalogue registration | P3 |

### 4.4 Gateway Capability Gap Register

| ID | Capability | Current Status | Priority | Implementation Note |
|---|---|---|---|---|
| GW-01 | Schema registry wired at publish/subscribe | ❌ MISSING | P0 | `validatePayload()` in `packages/events/src/schema-registry.ts` is ready but not called — wire it in `packages/queue/src/*/queue.ts` publish path |
| GW-02 | Payload field filtering by classification | ❌ MISSING | P0 | Before proxying, strip fields above caller's clearance level |
| GW-03 | Purpose enforcement (DPDP §3 `purposeCode`) | ❌ MISSING | P0 | Validate `purposeCode` header against data-sharing-agreement table |
| GW-04 | `officeId` + `district` header injection from JWT | ❌ MISSING | P0 | JWT must carry office claims; gateway enriches `x-office-id`, `x-district-lgd` headers |
| GW-05 | mTLS for inter-district and state calls | ❌ MISSING | P1 | Required for district→state event push; internal-secret is not sufficient |
| GW-06 | Digital signatures on government orders/events | ❌ MISSING | P1 | DSC sign outbound coordination events; verify inbound state/ministry events |
| GW-07 | Sandbox routing | ❌ MISSING | P1 | `x-sandbox: true` header → sandbox upstream; no prod data reaches staging |
| GW-08 | Replay protection (timestamp + nonce) | ❌ MISSING | P1 | Reject events with timestamp older than 5 min or duplicate nonce |
| GW-09 | Protocol conversion (SOAP→REST, REST→SDE) | ❌ MISSING | P2 | Needed for Treasury IFMS and legacy state APIs |
| GW-10 | Government Integration Gateway service | ❌ MISSING | P0 | New `services/gov-integration-gateway/` service |

---

## §5 — Priority Register

| ID | Finding | Priority |
|---|---|---|
| D19-01 | Event envelope missing `officeId`, `jurisdictionId`, `govLevel`, `district`, `state`, `classification` | P0 |
| D19-02 | Schema registry not wired — payload schema evolution unconstrained | P0 (from 07-integration-matrix INT-01) |
| D19-03 | Government Integration Gateway absent | P0 |
| D19-04 | PFMS adapter absent — central fund tracking impossible | P0 |
| D19-05 | CCTNS/ICJS read-only adapter absent — police-collector linkage blocked | P0 |
| D19-06 | State Treasury/IFMS adapter absent | P0 |
| D19-07 | 41 district governance event types absent from any topics.ts | P0 |
| D19-08 | Classification-based payload filtering absent at gateway | P0 |
| D19-09 | Purpose enforcement (DPDP §3) absent at gateway | P0 |
| D19-10 | `officeId`/`district` not in JWT claims or gateway forwarded headers | P0 |
| D19-11 | mTLS absent for inter-tier calls | P1 |
| D19-12 | Digital signatures absent for government orders | P1 |
| D19-13 | DigiLocker adapter stub — not connected to GIG | P1 |
| D19-14 | CPGRAMS adapter absent | P1 |
| D19-15 | Ministry-specific scheme platform adapters absent | P2 |

---

*Cross-references: 07-integration-matrix.md (existing envelope + registry findings), d17 (coordination events), d18 (scheme events), d20 (full integration matrix)*
