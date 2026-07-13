# D23b — Identity Federation & Configurability Assessment

**Lane:** L02 · **Date:** 2026-07-13  
**Reviewer role:** IAM Expert + Configurability Audit  
**Source branch:** `court-management-service` · repo at `/tmp/cms-wt`

> Prerequisites: read **D05** and **D06** for the hierarchy model. This file focuses on the identity/auth stack and configurability register.

---

## 1. Identity Stack — Verified Current State

### 1.1 Authentication

[VERIFIED] Auth mechanism: Keycloak OIDC/RS256 via `packages/auth/src/index.ts`.

```typescript
// packages/auth/src/index.ts:14-18 [VERIFIED]
// Token claims expected (set via Keycloak protocol mappers):
//   sub   — Keycloak user UUID
//   tid   — tenantId (custom claim via user attribute mapper)
//   roles — string[] from realm-roles-mapper
//   sid   — Keycloak session ID

export interface CivitasJwtPayload {
  sub: string;
  tid?: string;          // tenantId
  tenantId?: string;     // dev/test fallback
  roles: string[];       // flat array — no scope
  sid?: string;
  iat: number;
  exp: number;
  iss?: string;
}
```

[VERIFIED] Production enforces RS256 (Keycloak JWKS). HS256 shared-secret is test-only with fail-closed boot assertion (`packages/auth/tests/security.test.ts` — SEC-1 test). Gateway `tid` claim is authoritative (SEC-P0 fix in commit `2ba2911`).

[VERIFIED] Keycloak provisioning: `services/identity-service/src/shared/keycloak.ts` — creates realm users, deactivates them. **Best-effort** (gracefully degrades if Keycloak is unreachable). SCIM module at `identity-service/src/modules/scim/` exists for directory sync.

[VERIFIED] SAML: `identity-service/src/modules/saml/` module exists (for NIC/State SSO federation).

### 1.2 Authorisation — Current Decision Inputs

[VERIFIED] `packages/auth/src/permissions.ts` — policy evaluation call:

```typescript
body: JSON.stringify({
  permissionKey,
  actor: { userId: ctx.actorId, tenantId: ctx.tenantId, roles: ctx.roles },
  resource,
}),
```

[VERIFIED] `services/policy-service/src/modules/evaluate/domain.ts` — decision engine:

```typescript
export function evaluateDecision(
  permissionKey: string,
  actorRoles: string[],   // ← ONLY roles
  granted: Array<{ resource: string; action: string; effect: string; roleName: string }>,
): EvaluateResult {
  if (actorRoles.includes("super_admin")) { return allow; }
  const match = granted.find(p => p.effect === "allow" && p.resource === resource && p.action === action);
  // ...
}
```

[VERIFIED] The ABAC rules table exists: `abac.rules` in DB (`civitas_policy`):
```
abac | rules  — columns: id, tenant_id, role_id, expression (text), enabled
```
But: the `evaluateDecision` function does NOT load or evaluate `abac.rules`. The `expression` field has no documented evaluator — it is a dead table. The routes in `policy-service/src/modules/abac/routes.ts` likely provide CRUD for these rules but they are never consulted during an actual permission check.

### 1.3 RequestContext (the runtime identity envelope)

[VERIFIED] `packages/types/src/index.ts:71`:

```typescript
export interface RequestContext {
  tenantId:    string;
  actorId:     string;
  actorType:   'user' | 'service_account';
  roles:       string[];   // flat string array, no office/position scope
  correlationId: string;
  sessionId?:  string;
  idempotencyKey?: string;
}
```

**No office, position, jurisdiction, department, classification, or purpose field exists.**

---

## 2. Access Decision Gap Analysis

A district governance platform requires access decisions that consider **who the user is** (identity), **where they work** (office/jurisdiction), **what position they hold** (position/delegation), **what they are accessing** (resource classification), and **why** (purpose, workflow state). The current system only knows WHO (roles).

### 2.1 Current vs Required Decision Inputs

| Decision input | Required for | Current JWT | Current RequestContext | Gap |
|---|---|---|---|---|
| `tenantId` | Tenant isolation | ✓ (`tid`) | ✓ | None |
| `roles[]` | RBAC | ✓ | ✓ | None |
| `officeId` | Office-scoped access (SDM can only see their sub-division's files) | **ABSENT** | **ABSENT** | **P0** |
| `positionId` | Position-based powers (acting charge gets additional authority) | **ABSENT** | **ABSENT** | **P0** |
| `jurisdictionId[]` | Jurisdiction-scoped access | **ABSENT** | **ABSENT** | **P0** |
| `departmentCode` | Department isolation (Revenue can't see Police HR files) | **ABSENT** | **ABSENT** | **P0** |
| `hierarchyDomain` | Civil vs police access paths | **ABSENT** | **ABSENT** | **P0** |
| `classificationLevel` | File classification (SECRET, CONFIDENTIAL, etc.) | **ABSENT** | **ABSENT** | **P1** |
| `purpose` | Purpose limitation (DPDP Act 2023 §4) | **ABSENT** | **ABSENT** | **P1** |
| `workflowState` | Workflow-conditioned access (approver can see only pending items) | **ABSENT** | **ABSENT** | **P1** |
| `delegationIds[]` | Additional/acting charge powers | **ABSENT** | **ABSENT** | **P1** |
| `postingEffectiveFrom` | Time-bounded posting validity | **ABSENT** | **ABSENT** | **P1** |

### 2.2 Concrete Failure Scenarios (Current Model)

| Scenario | Current system behaviour | Required behaviour |
|---|---|---|
| SDM of Sub-division A views pending files from Sub-division B | **ALLOWS** — both SDMs have `sdm_role`; no jurisdiction check | **DENY** — jurisdiction filter on officeId |
| SP of District X pulls HR records of SP District Y | **ALLOWS** — if both have `hr_viewer` role | **DENY** — jurisdiction + office scope |
| Inspector (acting charge as DSP) approves budget beyond Inspector's financial powers | **Either ALLOWS or DENIES based on role alone** — acting charge not captured | **ALLOW** — delegation table grants temporary DSP powers |
| Collector leaves the district; new Collector onboarded | **New user gets roles manually** — old posting not expired | **Auto-expire** old posting at relieved_date; auto-grant to new posting |
| Revenue Inspector accesses police station attendance | **ALLOWS** if both are in `hrms_viewer` role | **DENY** — different hierarchy domain |

---

## 3. Proposed ABAC/PBAC Decision Model

### 3.1 Extended JWT Claims

[PROPOSED] Add context claims to the Keycloak JWT via protocol mappers (user attribute + user session note mappers):

```typescript
// [PROPOSED] packages/auth/src/index.ts — extended CivitasJwtPayload
export interface CivitasJwtPayload {
  sub:              string;
  tid:              string;            // tenantId (already present)
  roles:            string[];          // RBAC roles (already present)
  sid?:             string;

  // [NEW] Posting context (set at login from hierarchy.postings + hierarchy.positions)
  office_id?:       string;            // current primary office UUID
  position_id?:     string;            // current position UUID
  dept_code?:       string;            // department code (civil/police/revenue/etc.)
  hierarchy_domain?: string;           // 'civil' | 'police' | 'revenue' | 'health' | 'education'
  // Jurisdiction list (the units this officer has jurisdiction over)
  jur_unit_ids?:    string[];          // admin unit UUIDs (district, subdivision, tehsil...)
  // Delegation context
  delegation_ids?:  string[];          // active delegation UUIDs (acting charge grants)
  posting_from?:    string;            // ISO date (effective_from of current posting)
  posting_to?:      string | null;     // ISO date or null (current)

  // [NEW] Classification clearance (for eOffice/estab)
  clearance_level?: number;            // 0=unclassified, 1=restricted, 2=confidential, 3=secret, 4=top_secret

  iat: number;
  exp: number;
  iss?: string;
}
```

**Implementation note:** These claims should be added as lightweight lookup references (UUIDs) rather than embedding full objects. The `jur_unit_ids` list should include the officer's direct jurisdiction units only (not the full subtree — subtree expansion happens in the policy evaluation layer).

### 3.2 Extended RequestContext

[PROPOSED] `packages/types/src/index.ts`:

```typescript
// [PROPOSED] Extended RequestContext
export interface RequestContext {
  // Existing (keep)
  tenantId:          string;
  actorId:           string;
  actorType:         'user' | 'service_account';
  roles:             string[];
  correlationId:     string;
  sessionId?:        string;
  idempotencyKey?:   string;

  // [NEW] Office/position context
  officeId?:         string;
  positionId?:       string;
  deptCode?:         string;
  hierarchyDomain?:  string;

  // [NEW] Jurisdiction (populated from JWT jur_unit_ids; expanded to subtree by policy engine)
  jurisdictionUnitIds?: string[];

  // [NEW] Active delegations (acting/additional charge)
  delegationIds?:    string[];

  // [NEW] Clearance level for classified document access
  clearanceLevel?:   number;

  // [NEW] Purpose (DPDP §4 — set per-request by the calling service)
  purpose?:          string;
}
```

### 3.3 Policy Evaluation: ABAC Engine

[PROPOSED] Wire the existing `abac.rules` table to the `evaluateDecision` function:

```typescript
// [PROPOSED] services/policy-service/src/modules/evaluate/domain.ts

export type AbacContext = {
  officeId?:         string;
  jurisdictionUnitIds?: string[];
  hierarchyDomain?:  string;
  deptCode?:         string;
  delegationIds?:    string[];
  clearanceLevel?:   number;
  purpose?:          string;
  workflowState?:    string;
};

export function evaluateDecision(
  permissionKey:  string,
  actorRoles:     string[],
  granted:        GrantedPermission[],
  abacRules:      AbacRule[],          // loaded from abac.rules for actor's roles
  abacCtx:        AbacContext,         // from RequestContext
  resource:       Record<string, unknown>,
): EvaluateResult {
  // Step 1: RBAC fast path (existing)
  if (actorRoles.includes("super_admin")) return allow("role:super_admin");
  const rbacMatch = granted.find(p => p.effect === "allow" && ...);

  // Step 2: ABAC evaluation — each rule is a CEL/JsonLogic expression
  for (const rule of abacRules) {
    const result = evaluateExpression(rule.expression, { actor: abacCtx, resource });
    if (result === false) return deny(`abac:rule:${rule.id}`);
  }

  if (rbacMatch) return allow(`role:${rbacMatch.roleName}+${resource}.${action}`);
  return deny("no_permission");
}
```

The `expression` field in `abac.rules` should use a safe, sandboxed expression language. **Recommended: JSON Logic** (already available as a small JS library, deterministic, auditable). Each rule evaluates to true (allow) or false (deny).

Example rules:
```json
// "SDM can only access files within their jurisdiction"
{ "in": [{ "var": "resource.jurisdictionUnitId" }, { "var": "actor.jurisdictionUnitIds" }] }

// "Classified SECRET files require clearance_level >= 3"
{ ">=": [{ "var": "actor.clearanceLevel" }, 3] }

// "Acting charge: delegation grants DSP powers temporarily"
{ "in": ["dspm_powers_delegation", { "var": "actor.delegationIds" }] }
```

### 3.4 Session Refresh on Posting Change

When a posting changes (transfer order executed), the officer's JWT claims become stale. The system needs:

1. A Keycloak back-channel logout event on posting change.
2. The next login re-derives `officeId`, `positionId`, `jurisdictionUnitIds` from `hierarchy.postings` + `hierarchy.positions`.

[PROPOSED] Event contract:

```typescript
// packages/events/src/hierarchy.events.ts
export const POSTING_ACTIVATED = 'hierarchy.posting.activated';
export const POSTING_EXPIRED   = 'hierarchy.posting.expired';

export interface PostingActivatedEvent {
  employeeId:  string;
  userId:      string;
  positionId:  string;
  officeId:    string;
  chargeType:  'regular' | 'additional' | 'acting' | 'temporary';
  effectiveFrom: string;
  correlationId: string;
}
```

The identity-service consumes `POSTING_ACTIVATED` → calls Keycloak backchannel logout for that user → next login picks up new posting context.

---

## 4. Configurability Register

This section catalogues every hardcoded item found in the codebase that would cause a code fork for a different state, department, or district topology.

### 4.1 Hardcoded Items — Confirmed [VERIFIED]

| # | Item | Location | Type | Risk |
|---|---|---|---|---|
| C-01 | `UNIT_TYPES` hierarchy levels (6 values) | `location-service/src/modules/hierarchy/validators.ts:4` | `as const` + PG enum | **P0** — DDL migration to add tehsil, village, etc. |
| C-02 | `JURISDICTION_LEVELS` | `location-service/src/modules/jurisdiction/validators.ts:4` | `as const` array | **P0** — mirrors C-01 |
| C-03 | `CENTRAL_GOVT_TYPES` dept vocabulary | `hrms-service/src/modules/employee/dept-domain.ts` | TypeScript `as const` | **P1** |
| C-04 | `STATE_GOVT_TYPES` dept vocabulary | same file | TypeScript `as const` | **P1** |
| C-05 | `LOCAL_BODY_TYPES` dept vocabulary | same file | TypeScript `as const` | **P1** |
| C-06 | `STATUTORY_TYPES`, `PSU_TYPES`, `PRIVATE_TYPES`, `NGO_TYPES`, `COOPERATIVE_TYPES`, `SMALL_OFFICE_TYPES` | same file | TypeScript `as const` | **P2** |
| C-07 | `govtTier` enum | `hrms-service/src/modules/employee/masters-routes.ts:21` | `z.enum([...])` | **P1** — adding new org type needs code PR |
| C-08 | Service-account hardcoded roles | `packages/auth/src/context.ts:48` | string literal | **P1** — `["super_admin","hr_admin","payroll_admin","finance_admin"]` |
| C-09 | Role names: `"super_admin"`, `"location_admin"`, `"admin"`, `"hr_admin"`, etc. | scattered across all 38 service routes | string literals in `requireRole()` calls | **P2** — role naming conventions should flow from config |
| C-10 | `HIERARCHY_ROLES = ["location_admin", "super_admin", "admin"]` | `location-service/src/modules/hierarchy/routes.ts` | const array | **P2** |
| C-11 | `JURISDICTION_ROLES = ["location_admin", "super_admin", "admin"]` | `location-service/src/modules/jurisdiction/routes.ts` | const array | **P2** |

### 4.2 Not Hardcoded (Confirmed Absent) [VERIFIED]

The following state/district-specific terminology was checked via `grep -rn "tehsil\|sdm\|collector\|constable\|inspector\|designation\|rank\|Mamlatdar\|Tehsildar\|BDO\|MRO\|RDO"` across all 38 services:

- **SDM / Sub-Collector / RDO / Mamlatdar / Tehsildar / MRO** — NOT hardcoded as enum values or const literals. These appear only in comments and docs. ✓
- **Constable / Inspector / DSP** — NOT hardcoded. ✓
- **Tehsildar / BDO / Sarpanch** — NOT hardcoded. ✓
- Designation names in `hrms_designations` table are free-text (`name TEXT`), not enum-controlled. ✓

This is correct and should be maintained. Designation terminology MUST remain as data (configurable per state/tenant), not code.

### 4.3 Items That Must Become Config-Driven

| Item | Proposed config mechanism | Where stored |
|---|---|---|
| Unit types (tehsil vs taluk vs mandal) | `hierarchy.unit_types` lookup table (D05 §4.1) | civitas_location DB, per tenant |
| Office types (Collectorate, SDM Office, Police Station) | `hierarchy.office_types` lookup table (D05 §4.2) | civitas_location DB, per tenant |
| Dept-type vocabulary (CENTRAL_GOVT_TYPES etc.) | Move to `hierarchy.office_types` with `hierarchy_domain` | civitas_location DB |
| `govtTier` Zod enum | Replace with DB lookup; validate against `hierarchy.office_types.domain` | Remove from Zod, validate against DB |
| Role names used in `requireRole()` | Keep as code (RBAC roles are by design tenant-configurable via policy-service UI) | policy-service / Keycloak realm |
| Service-account hardcoded role array | Move to `INTERNAL_SERVICE_ROLES` env var or config table | admin-service config |

### 4.4 Missing Configurability: Approval Chain & Financial Powers

[VERIFIED] `estab_approval_rule` table has `module`, `source_type`, `min_amount_minor`, `max_amount_minor`, `workflow_definition_code` — but no link to position/office. Financial delegation limits (GFR Rule 23 schedules, state delegation orders) cannot be encoded per-position today.

[PROPOSED] The `hierarchy.delegations` table (D05 §4.6) bridges this: each delegation row has `power_code` (e.g. `gfr_23_item_4`), `max_amount_minor`, `from_position_id`, `to_position_id`, `effective_from/to`. The approval-rule engine should join against this table to determine whether a given officer's position has the required financial power.

---

## 5. NIC/State SSO Federation

[VERIFIED] `services/identity-service/src/modules/saml/` module exists (SAML SP capability). This enables federation with:
- NIC e-Pramaan / MeriPehchaan (central govt SSO)
- State-level SSO portals (e.g. Rajasthan SSO, Karnataka OneGov)

[GAP] No verified evidence of:
- `AzureAD / Entra ID` / `DigiLocker` OIDC federation configuration
- Cross-tenant SSO (officer posted to another state's department)
- OIDC claims mapping from NIC SSO → CivitasOne JWT (the `tid` claim must be injected; NIC tokens won't have it)

[PROPOSED] Keycloak Identity Provider (IdP) brokering is the right pattern — NIC/State SSO acts as upstream IdP; Keycloak transforms claims (adds `tid`, `officeId`) via protocol mappers. This requires:

```
NIC e-Pramaan → Keycloak (IdP broker) → adds tid + office_id claims → CivitasJwtPayload
```

The SAML module in identity-service should be extended with claim mapping configuration (stored in `admin_module_configs` per tenant).

---

## 6. End-to-End Identity Flow (Proposed)

```
1. Officer logs in via NIC/State SSO or Keycloak native
   → Keycloak authenticates, issues JWT with: sub, tid, roles[], office_id, position_id,
     dept_code, hierarchy_domain, jur_unit_ids[], delegation_ids[], clearance_level

2. JWT presented to API Gateway
   → Gateway verifies RS256 signature, extracts tid (authoritative, SEC-P0 fix in place)
   → Injects x-tenant-id header for downstream services (already implemented)

3. Service receives request, calls authPlugin
   → Builds RequestContext: adds officeId, positionId, jurisdictionUnitIds,
     hierarchyDomain from JWT claims [PROPOSED — not yet built]

4. Service calls checkPermission(ctx, "finance.budget.approve", { amount: 500000 })
   → policy-service evaluateDecision runs:
     a. RBAC: does the actor's role have finance.budget.approve? (existing)
     b. ABAC: does the actor's jurisdiction cover the resource's unit? [PROPOSED]
     c. ABAC: does actor's position/delegation have financial power ≥ 500000? [PROPOSED]
   → Returns allow/deny

5. On posting change (transfer order executed):
   → hierarchy.posting.activated event published
   → identity-service receives event → Keycloak backchannel logout
   → Officer's next login gets new office_id, position_id, jur_unit_ids in JWT
```

---

## 7. Prioritised Gaps

| Gap ID | Description | Priority |
|---|---|---|
| G-I01 | `RequestContext` missing officeId, positionId, jurisdictionUnitIds, hierarchyDomain | **P0** |
| G-I02 | JWT claims missing office/position/jurisdiction (Keycloak protocol mapper not configured) | **P0** |
| G-I03 | ABAC expression engine not wired — `abac.rules` table is a dead table | **P0** |
| G-I04 | Policy binding has no office/jurisdiction scope (flat userId→roleId mapping) | **P0** |
| G-I05 | Role assignments have no effective dates | **P0** |
| G-I06 | No session refresh on posting change | **P0** |
| G-I07 | `govtTier` and dept-type vocabularies hardcoded in TypeScript | **P1** |
| G-I08 | Unit types hardcoded as PG enum — requires DDL to extend | **P0** |
| G-I09 | No classification clearance level in identity/auth | **P1** |
| G-I10 | No purpose field in RequestContext (DPDP §4) | **P1** |
| G-I11 | No delegation of powers model (acting charge, additional charge) | **P1** |
| G-I12 | NIC/State SSO claim mapping not implemented (SAML module exists but mapping config absent) | **P1** |
| G-I13 | Cross-tenant officer posting (inter-state deputation) not supported | **P3** |
| G-I14 | Service-account roles hardcoded in `packages/auth/src/context.ts:48` | **P1** |

---

## 8. Implementation Sequence (P0 items)

**Week 1:**
1. Deploy `hierarchy.administrative_units` + `jurisdiction.jurisdictions` migrations (G-H01, G-H07)
2. Replace PG enum with `hierarchy.unit_types` lookup table (G-H02, C-01)
3. Add `hierarchy.offices`, `hierarchy.positions`, `hierarchy.postings` tables (G-H04–G-H06)

**Week 2:**
4. Extend `RequestContext` and `CivitasJwtPayload` with office/position/jurisdiction fields (G-I01, G-I02)
5. Add Keycloak protocol mappers for `office_id`, `position_id`, `jur_unit_ids` (populated from posting at login)
6. Wire ABAC expression evaluator in policy-service `evaluateDecision` (G-I03)

**Week 3:**
7. Add `valid_from`/`valid_to` to `bindings.bindings` and `rbac.role_assignments` (G-I05)
8. Publish `hierarchy.posting.activated/expired` events; identity-service subscribes for session invalidation (G-I06)
9. Implement `hierarchy.delegations` table and load into `delegationIds[]` claim (G-I11)

**Week 4 (P1):**
10. Move dept-type vocabulary to `hierarchy.office_types` DB table, remove TypeScript const arrays (G-I07, C-03–C-07)
11. Add `clearanceLevel` to JWT/RequestContext; wire to estab classification gate (G-I09)
12. Configure NIC SSO claim mapping in Keycloak IdP broker (G-I12)

---

## 9. Summary Scorecard

| Dimension | Current Score | Target (post-P0) |
|---|---|---|
| Authentication (Keycloak RS256) | 8/10 | 9/10 |
| JWT claims richness (office/position/jurisdiction) | 1/10 | 8/10 |
| RBAC correctness | 7/10 | 8/10 |
| ABAC/PBAC (office+jurisdiction+delegation) | 0/10 | 7/10 |
| Configurability (no hardcoded state structures) | 3/10 | 8/10 |
| Posting lifecycle (effective dates, charge type) | 2/10 | 8/10 |
| Cross-hierarchy domain isolation (civil vs police) | 0/10 | 7/10 |
| **Overall identity+config readiness** | **2/10** | **8/10** |

The platform has a solid authentication foundation (Keycloak, RS256, MFA, SCIM, SAML) but the authorisation layer is insufficient for a multi-hierarchy, multi-jurisdiction district governance context. The ABAC infrastructure exists as a skeleton (the `abac.rules` table and topic names are defined) but is not wired into the decision engine. The configurability layer conflates geography with organisation, lacks configurable unit types, and hard-codes vocabulary that must vary by state.

---

LANE_DONE L02 score=2
