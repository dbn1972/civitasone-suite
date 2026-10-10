# SmartTransfer OS — API sketch

> Spec §4, §9 (employee self-service), §10 (18 command-centre screens), §11 (module integration), §19 deliverable 12.
> Baseline: `origin/main` `9d4fa95e5`. **This is a sketch, not a frozen OpenAPI.** The OpenAPI document and the
> handlers are built from ST-M01-12 onward.
>
> **Every write follows** route → `zod` → command with an explicit per-command `messageId` → `202 Accepted` →
> consumer (CLAUDE.md §6; `KIRO-BUILD-PROMPT.md` §4.1). The consumer runs `markProcessed`, the guarded write and the
> `audit.event.record` outbox event in one transaction. **Reads** go through `getOrLoad`. The `messageId` is a
> per-command id (e.g. `commandId(ctx, "<topic>:<id>")`), **never** the entity id (WAVE0-DECISIONS.md §3).

## Conventions

- **Prefix:** `/api/v1/smarttransfer` at the gateway (M00 §4.1). Sub-route gateway keys are introduced by ST-M01-04 so
  the `hrms` key no longer unlocks leave/payroll/etc.
- **Auth:** every route is authenticated via `@civitasone/auth` (`authPlugin`). Each route has a role guard built on
  `hasAnyRole(ctx, [...])` (`packages/auth/src/index.ts:294`) — referred to as `requireRole` in the house rules.
  **Staff-only routes exclude `citizen`.** The seven canonical roles are
  `super_admin, tenant_admin, dept_head, officer, auditor, citizen, service_account`
  (`packages/auth/src/plugin.ts:121`).
- **Jurisdiction scoping:** tenant, organisation and jurisdiction are derived from the **server context**, never from
  client ids (house rule 9; spec §P08). Lists are filtered to the caller's jurisdiction. The org/jurisdiction claims
  (`office_id`, `position_id`, `jurisdiction_unit_ids`, `packages/auth/src/index.ts:38-46`) are resolved **service-side**
  per request for v1 (D-ST-11 option (a) is PROPOSED — the resolver call is the planned shape; see
  [open-items.md](open-items.md)).
- **Entitlement:** `smarttransfer-service` re-checks its own module entitlement in-service (defence in depth; STANDALONE §5.6).
- **Errors:** `fromException` / `resolveHumanError`; no raw `e.message` (house rule 6). i18n `en`+`hi` via `t()`.
- **202 outcome:** the result is read back through the `command-result` channel (D-20); a refusal is not lost after 202
  (M00 §1A, FF-01).

Role abbreviations below: **ADM** = `tenant_admin`/`dept_head` (HR admin), **OFF** = `officer`, **EMP** = officer acting
as the employee (self-service), **APR** = competent authority (an `officer`/`dept_head` in an approver band, enforced in
the consumer by SoD), **AUD** = `auditor`.

## Officer self-service (spec §9)

| Method | Route | Command topic | messageId | Role | Jurisdiction |
|---|---|---|---|---|---|
| GET | `/me/service-history` | — (read via `getOrLoad`) | — | EMP | self only |
| GET | `/me/eligibility?cycleId=` | — | — | EMP | self only |
| POST | `/me/requests` | `smarttransfer.request.submitted` | `request:{cycleId}:{employeeId}` | EMP | self only |
| POST | `/me/requests/:id/withdraw` | `smarttransfer.request.withdrawn` | `request-withdraw:{id}` | EMP | own request |
| PUT | `/me/preferences/:cycleId` | `smarttransfer.preference.submitted` | `preference:{cycleId}:{employeeId}` | EMP | self only |
| POST | `/me/appeals` | `smarttransfer.appeal.submitted` | `appeal:{orderId}:{employeeId}` | EMP | own order |
| GET | `/me/orders/:id` | — | — | EMP | own order; download logged |

## Command centre (spec §10, 18 screens)

| Method | Route | Command topic | messageId | Role | Screen |
|---|---|---|---|---|---|
| POST | `/cycles` | `smarttransfer.cycle.created` | `cycle:{slug}` | ADM | 1 Cycle Dashboard |
| POST | `/cycles/:id/open` | `smarttransfer.cycle.opened` | `cycle-open:{id}` | ADM | 4 Policy Version Lock |
| POST | `/cycles/:id/freeze` | `smarttransfer.cycle.frozen` | `cycle-freeze:{id}` | ADM | 3 Establishment & Vacancy Certification |
| POST | `/cycles/:id/close` | `smarttransfer.cycle.closed` | `cycle-close:{id}` | APR | 18 Cycle Closure & Reconciliation |
| GET | `/cycles/:id/eligibility` | — | — | ADM/AUD | 2 Eligibility Register |
| GET | `/cycles/:id/preferences` | — | — | ADM | 5 Preference Monitoring |
| POST | `/cycles/:id/scenarios` | `smarttransfer.scenario.created` | `scenario:{cycleId}:{name}` | ADM | 6 Allocation Simulation Console |
| POST | `/scenarios/:id/runs` | `smarttransfer.run.requested` | `run:{scenarioId}:{seed}` | ADM | 6 Allocation Simulation Console |
| GET | `/runs/:id` | — | — | ADM | 7 Constraint Violation Diagnostics |
| GET | `/runs/:id/diagnostics` | — | — | ADM | 7 Constraint Violation Diagnostics |
| GET | `/cycles/:id/scenarios/compare` | — | — | ADM | 8 Scenario Comparison |
| GET | `/runs/:id/assignments` | — | — | ADM | 9 Proposed Transfer List |
| POST | `/assignments/:id/exceptions` | `smarttransfer.exception.requested` | `exception:{assignmentId}` | ADM | 10 Exception & Manual Review |
| POST | `/cycles/:id/committee-review` | *(approval path OPEN D-ST-08)* | `committee:{cycleId}` | APR | 11 Committee Review |
| POST | `/cycles/:id/approve` | *(approval path OPEN D-ST-08)* | `approve:{cycleId}` | APR | 12 Competent Authority Approval |
| POST | `/runs/:id/orders` | `smarttransfer.order.drafted` | `order-draft:{assignmentId}` | ADM | 13 Bulk Order Generation |
| POST | `/orders/:id/issue` | `smarttransfer.order.issued` | `order-issue:{id}` | APR | 13 Bulk Order Generation |
| POST | `/orders/:id/cancel` | `smarttransfer.order.cancelled` | `order-cancel:{id}` | APR | 13 Bulk Order Generation |
| POST | `/orders/:id/relieving` | `smarttransfer.relieving.recorded` | `relieve:{orderId}` | OFF (releasing-office authority; not the employee) | 14 Relieving & Joining Tracker |
| POST | `/orders/:id/joining` | `smarttransfer.joining.recorded` | `join:{orderId}` | OFF (receiving-office authority; not the employee) | 14 Relieving & Joining Tracker |
| GET | `/cycles/:id/appeals` | — | — | ADM | 15 Grievance & Appeals |
| POST | `/appeals/:id/decide` | `smarttransfer.appeal.decided` | `appeal-decide:{id}` | APR | 15 Grievance & Appeals |
| GET | `/cycles/:id/staffing-balance` | — | — | ADM | 16 Staffing Balance Dashboard |
| GET | `/runs/:id/evidence` | — | — | AUD | 17 Audit & Decision Evidence |

Notes:
- Each screen must have distinct empty, error, permission-denied and partial-failure states (house rule 6; spec §10).
- `committee-review`/`approve` have no frozen command topic in C0 because the **approval path is OPEN (D-ST-08)**.
- **Relieving and joining ownership:** `relieving` is recordable only by an officer whose server-derived
  `jurisdiction_unit_ids` cover the order's **source** office; `joining` only by one covering the **destination**
  office. The consumer rejects a record where the caller's employee id equals the order's `employeeId` (the employee
  cannot record their own relieving or joining; SoD, house rule 5). The route guard alone is not sufficient.
- **Cycle cancellation** (`cancelCycle` in [state-machines.md](state-machines.md)) has no route or topic in C0: it is
  **OPEN** (see [open-items.md](open-items.md)) and will add `smarttransfer.cycle.cancelled` when decided.
- SoD (approver ≠ maker; competent-authority bands from policy) is enforced in the **consumer** (house rule 5), not only
  in the route guard.

## HRMS / Workforce Core command path (spec §11.1; [ADR-0010](adr/0010-hrms-write-boundary.md))

SmartTransfer never writes HRMS tables. It calls the one HRMS command. The command `hrms.posting.apply` is **published by
`smarttransfer-service`** (after `smarttransfer.order.issued`) and consumed inside hrms-service.

| Method (internal) | Route | Command topic | messageId | Caller | Idempotency |
|---|---|---|---|---|---|
| POST | `/internal/postings/apply` | `hrms.posting.apply` | `applyPosting:{orderId}` | SmartTransfer via scoped service credential | idempotent on **order id** (ST-M01-09) |

- The HRMS-side consumer writes occupancy, posting ledger, employee current office, service book and audit, then emits
  one rich posting event, all in one transaction (ST-M01-09). Paths A/B/C and deputation become thin callers (D-ST-09,
  **PROPOSED** — see [open-items.md](open-items.md)).
- The SmartTransfer→HRMS call uses a **scoped service credential**, not the fleet-wide `x-internal` super_admin
  principal (M00 §8.5; ST-M01-15).

## Money

No money fields appear in the C0 surface. Any added later (e.g. a payroll reconciliation record under D-ST-13/14,
**OPEN**) must be `bigint` minor units validated with `/^\d+$/` plus an ISO 4217 code, never float or
`z.coerce.number()` (house rule 4; CLAUDE.md §3.11).
