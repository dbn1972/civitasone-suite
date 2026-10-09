# ADR-0010: Write boundary — SmartTransfer never writes HRMS / Workforce Core tables

- **Status:** Accepted
- **Decision id:** D-ST-10 (APPROVED, approval log 2026-10-09)
- **Date:** 2026-10-09
- **Deciders:** Chief Architect; programme owner dbn1972 (approved)
- **Spec:** §4; §7 (the solver never writes HRMS/Payroll/position masters); §11.1; §P02; §P04
- **Related:** [ADR-0001](0001-post-and-occupancy-owner.md), [ADR-0023](0023-standalone-packaging.md); house rules 1–2;
  CLAUDE.md §3.1–§3.4, §3.13

## Context

CivitasOne enforces **database-per-service** with its own DB login and **zero cross-database grants**; a service
physically cannot read or write another service's data (CLAUDE.md §3.1). There are **no cross-service SQL writes and no
cross-service foreign keys** (CLAUDE.md §3.3, §3.13); cross-service writes go through the queue. The architecture guard
greps for cross-service imports (`.github/workflows/ci.yml` arch-guard job, "no cross-service DB joins" step).

Workforce Core owns posts, occupancy and the posting ledger ([ADR-0001](0001-post-and-occupancy-owner.md)).
SmartTransfer is a separate service ([ADR-0023](0023-standalone-packaging.md); M00 §4.1) that proposes and authorises
movements but must not become a second writer of workforce master data.

## Decision

**SmartTransfer never writes HRMS / Workforce Core tables.** It changes a posting **only** through a single idempotent
HRMS command, `applyPosting`.

- Write path: SmartTransfer publishes the `hrms.posting.apply` **command** (`messageId = applyPosting:{orderId}`); the
  HRMS-side consumer writes occupancy, the posting ledger, the employee current office, service book and audit, then
  emits one rich event — **all in one transaction** (ST-M01-09).
- `applyPosting` is **idempotent on the order id**, never the employee id (WAVE0-DECISIONS.md §3).
- Reads from SmartTransfer into Workforce Core go through `getOrLoad` over internal HTTP or a frozen snapshot
  (M00 §6.1–§6.2) — never cross-service SQL, never a cross-service FK.
- SmartTransfer references Workforce Core / location entities **by opaque id + as-of version** only (see
  [ER model §3](../er-diagram.md)).
- The SmartTransfer→HRMS call uses a **scoped service credential**, not the fleet-wide `x-internal` super_admin
  principal (M00 §8.5; delivered by ST-M01-15).

## Consequences

- Occupancy and the employee row change atomically inside HRMS, consistent with [ADR-0001](0001-post-and-occupancy-owner.md).
- A refused `applyPosting` is surfaced through the `command-result` channel (D-20), not lost after the 202 (M00 §1A,
  FF-01).
- The DB-per-service arch guard stays green: SmartTransfer imports no HRMS schema and opens no HRMS connection.
- The solver likewise touches no database (M00 §4.1), consistent with spec §7.

## Alternatives considered

- **(b) Shared DB writes** — rejected: violates DB-per-service (CLAUDE.md §3.1) and the arch guard, and defeats the
  single-writer invariant on occupancy.
