# SmartTransfer OS — event list (contract pack C0)

> Spec §4, §11 (module integration), §18 (M01). Baseline: `origin/main` `9d4fa95e5`.
>
> This is the **frozen topic surface** for ST-M01-06, which ships a `defineContract` for every row below in **enforce**
> mode ([ADR-0019](adr/0019-event-contract-policy.md); D-ST-19). The contract DSL is
> `packages/events/src/contracts/define.ts`.
>
> **Topic-name length rule (D-ST-19):** the queue derives a per-service queue name from the topic with dots replaced by
> dashes, truncated to `TOPIC_BASE_MAX = 45` (`services/queue-service/src/bus.ts:475-478`,
> `topicBaseName`/`perServiceQueueName` at `:476-495`). Every topic below is **≤ 45 characters after dot-to-dash**, so
> none is truncated (collision-safe). The "len" column is the measured length of the dash form.
>
> **Naming convention** (docs/ARCHITECTURE.md §4): commands are `{service}.{aggregate}.{action}`; events are
> `{service}.{aggregate}.{pastTense}`. **Kind** below marks each as command (C) or event (E); a topic is one or the
> other, never both (`define.ts` rule 2).
>
> No topic payload carries money in C0. If one is added later it is a wire **string** ending in `Minor` with a required
> `currency` from schema v2 (D-18; `define.ts` money rule). All PII fields must be declared in the contract's `pii: []`
> list (M00 §8.2); the sensitive attributes (category, disability, medical, spouse) must **not** appear in event
> payloads — they stay in the snapshot (M00 §8.2).

## `smarttransfer.*` topics (producer: `smarttransfer-service`)

| Topic | dash len | Kind | Producer | Consumers | Payload outline | Ver |
|---|---|---|---|---|---|---|
| `smarttransfer.cycle.created` | 27 | E | smarttransfer | audit; notification | `cycleId, tenantId, name, movementTypeId, calendar{opensAt,freezesAt,closesAt}` | 1.0 |
| `smarttransfer.cycle.opened` | 26 | E | smarttransfer | audit; notification | `cycleId, tenantId, policyPackId, policyPackHash, openedAt` | 1.0 |
| `smarttransfer.cycle.frozen` | 26 | E | smarttransfer | audit; (solver via snapshot) | `cycleId, tenantId, snapshotId, snapshotHash, policyPackId, policyPackHash, counts{employees,posts}` | 1.0 |
| `smarttransfer.cycle.closed` | 26 | E | smarttransfer | audit; notification | `cycleId, tenantId, closedAt, reconciliationRef` | 1.0 |
| `smarttransfer.request.submitted` | 31 | E | smarttransfer | audit; notification | `requestId, cycleId, tenantId, employeeId, movementTypeId` | 1.0 |
| `smarttransfer.request.withdrawn` | 31 | E | smarttransfer | audit; notification | `requestId, cycleId, tenantId, employeeId, reasonCode` | 1.0 |
| `smarttransfer.preference.submitted` | 34 | E | smarttransfer | audit | `preferenceId, cycleId, tenantId, employeeId, itemCount` | 1.0 |
| `smarttransfer.scenario.created` | 30 | E | smarttransfer | audit | `scenarioId, cycleId, tenantId, name, weightsRef` | 1.0 |
| `smarttransfer.exception.requested` | 33 | E | smarttransfer | audit; notification | `exceptionId, assignmentId, runId, tenantId, reasonCode, requestedBy` | 1.0 |
| `smarttransfer.run.requested` | 27 | C | smarttransfer | smarttransfer (run coordinator) | `runId, scenarioId, cycleId, tenantId, snapshotId, policyPackHash, seed` | 1.0 |
| `smarttransfer.run.completed` | 27 | E | smarttransfer | audit; notification | `runId, cycleId, tenantId, outputHash, score, assigned, unassigned` | 1.0 |
| `smarttransfer.run.failed` | 24 | E | smarttransfer | audit; notification | `runId, cycleId, tenantId, reasonCode` | 1.0 |
| `smarttransfer.assignment.proposed` | 33 | E | smarttransfer | audit | `assignmentId, runId, tenantId, employeeId, postId, justificationRef` | 1.0 |
| `smarttransfer.solve.requested` | 29 | C | smarttransfer | allocation-solver | `runId, tenantId, snapshotRef, arcsRef, weightsRef, seed` | 1.0 |
| `smarttransfer.solve.completed` | 29 | E | allocation-solver | smarttransfer | `runId, tenantId, planRef, planHash, score, hardViolations` | 1.0 |
| `smarttransfer.order.drafted` | 27 | E | smarttransfer | audit | `orderId, assignmentId, tenantId, orderNumber` | 1.0 |
| `smarttransfer.order.issued` | 26 | E | smarttransfer | audit; notification; smarttransfer (publishes `hrms.posting.apply` on this event) | `orderId, assignmentId, tenantId, employeeId, postId, orderNumber, effectiveDate, signingState` | 1.0 |
| `smarttransfer.order.cancelled` | 29 | E | smarttransfer | audit; notification | `orderId, tenantId, reasonCode, cancelledBy` | 1.0 |
| `smarttransfer.relieving.recorded` | 32 | E | smarttransfer | audit; notification | `orderId, tenantId, employeeId, sourceOfficeId, relievedOn` | 1.0 |
| `smarttransfer.joining.recorded` | 30 | E | smarttransfer | audit; notification | `orderId, tenantId, employeeId, destOfficeId, joinedOn` | 1.0 |
| `smarttransfer.appeal.submitted` | 30 | E | smarttransfer | audit; notification | `appealId, orderId, tenantId, employeeId, groundCode` | 1.0 |
| `smarttransfer.appeal.decided` | 28 | E | smarttransfer | audit; notification | `appealId, orderId, tenantId, outcome, decidedBy, reasonCode` | 1.0 |
| `smarttransfer.evidence.recorded` | 31 | E | smarttransfer | audit | `evidenceId, runId, tenantId, snapshotHash, policyPackHash, solverVersion, seed` | 1.0 |

## `hrms.posting.*` topics

Producers differ per row: `hrms.posting.apply` is a **command published by `smarttransfer-service`** and consumed by
hrms-service; the other four are events published by `hrms-service` / Workforce Core.

| Topic | dash len | Kind | Producer | Consumers | Payload outline | Ver |
|---|---|---|---|---|---|---|
| `hrms.posting.apply` | 18 | C | **smarttransfer-service** (published by SmartTransfer, not hrms) | hrms (applyPosting consumer) | `orderId, tenantId, employeeId, postId, effectiveDate, chargeType, orderNumber` | 1.0 |
| `hrms.posting.applied` | 20 | E | hrms | audit; smarttransfer (reconciliation) | `orderId, tenantId, employeeId, postId, chargeType, effectiveFrom, orderNumber` | 1.0 |
| `hrms.posting.changed` | 20 | E | hrms | payroll (OPEN D-ST-13); audit; estab (quarters/desks); notification | `employeeId, tenantId, fromOfficeId, toOfficeId, station, state, cityClass, ddo, effectiveFrom, orderNumber` | 1.0 |
| `hrms.posting.hold_placed` | 24 | E | hrms | audit; smarttransfer (eligibility, OPEN D-ST-16) | `employeeId, tenantId, holdType, effectiveFrom, source` | 1.0 |
| `hrms.posting.hold_released` | 26 | E | hrms | audit; smarttransfer (eligibility, OPEN D-ST-16) | `employeeId, tenantId, holdType, releasedOn, source` | 1.0 |

## Notes on consumers that depend on PROPOSED decisions

The producer and the contract of every row above are frozen by this pack. Some **consumers** depend on PROPOSED
decisions and are therefore **OPEN** (see [open-items.md](open-items.md)), but adding a consumer later does not change
the contract (tolerant reader; `define.ts` rule 5):

- `payroll` consuming `hrms.posting.changed` → **OPEN D-ST-13** (payroll scope). The `cityClass`/`ddo`/`state` fields
  support the dated posting/DDO history planned in ST-M01-11; today `hra_city_class` is unwritten
  (`employee/schema.ts:54`, default `X`).
- `smarttransfer` consuming `hrms.posting.hold_placed`/`.hold_released` for eligibility → **OPEN D-ST-16** (hold
  registry consumption). The `hrms_employee_holds` table exists (`lifecycle/schema.ts:212-232`) but is read by no
  transfer path today (M00 §1.3).
- `allocation-solver` on `smarttransfer.solve.*` → the solver **runtime** is **OPEN D-ST-05/06**; the topic contract is
  independent of the chosen engine (`SolverPort`, M00 §4.1).

## Existing HRMS transfer topics (context, not re-defined here)

For completeness: `hrms.employee.transfer`, `hrms.employee.transfer.submit_approval`
(`services/hrms-service/src/topics.ts:6-7`) and `hrms.employee.transferred` (`:222`) already exist. The last is
**unsubscribed** today (M00 §0.4) and its payload lacks station/state/city-class/DDO/dates/order-number. ST-M01-09
delivers the enriched `hrms.posting.changed` event above; whether `hrms.employee.transferred` is superseded or kept is
part of the `applyPosting` consolidation (**D-ST-09, PROPOSED**) and is **not** decided here.
