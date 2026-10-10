# ADR-0001: Owner of the sanctioned Post and effective-dated Occupancy

- **Status:** Accepted
- **Decision id:** D-ST-01 (APPROVED, `smarttransfer/M00/DECISIONS.md` approval log, 2026-10-09)
- **Date:** 2026-10-09
- **Deciders:** HR domain owner (decides); Chief Architect (proposes); programme owner dbn1972 (approved)
- **Spec:** §4 (Universal domain model); §18 M01; §P02 (extend, never duplicate); §P04 (explicit data ownership)
- **Related:** [ADR-0002](0002-office-hierarchy-owner.md), [ADR-0003](0003-cadre-master-owner.md),
  [ADR-0010](0010-hrms-write-boundary.md), [ADR-0023](0023-standalone-packaging.md)

## Context

The platform has **no authoritative sanctioned-post identity**. Four unlinked stores hold fragments, none of which is a
canonical post with effective-dated occupancy (M00 §1.4, verified on `origin/main` `9d4fa95e5`):

- `manpower.plans` — `(unit, cadre text, year)` counters; `filled` increments on hire only (`manpower-planning/schema.ts:8-27`).
- `reservation.hrms_sanctioned_posts` — `(cadre text)` strength, no occupancy (migration `0022:194`).
- `tenant.positions` — org-unit/code/grade; `filled_strength` never written (`positions/schema.ts:5-20`).
- `hierarchy.positions/postings/offices` — the closest prior art: a posting has an employee, charge type, dates and a
  unique substantive-holder index (`location-service/migrations/0005a_org_model.sql:136-161`), but **no runtime writer**
  and no FK to hrms.

A transfer engine allocates employees **against** posts, so whoever owns the post defines the architecture. Because
`hrms-service` owns the employee, placing the post there lets occupancy and the employee row change in **one
transaction** (no cross-service write split). The alternative of writing `hierarchy.postings` from HRMS would split the
employee+posting transaction across two services (STANDALONE §4, L5 F8).

## Decision

The canonical **Post** (sanctioned position: office, designation, cadre, grade, attributes, status) and its
**effective-dated Occupancy** (one substantive holder per post) are owned by **Workforce Core** — a module profile of
`hrms-service` ([ADR-0023](0023-standalone-packaging.md)) — in **its own schema** so the tables are liftable later.

- New tables: `post`, `post_occupancy` (effective-dated), plus `posting_ledger` (ADR-0003/ER model), delivered by
  **ST-M01-07**.
- `post_occupancy` enforces **at most one open substantive holder per post** per tenant, mirroring the prior-art partial
  unique index `uniq_postings_substantive` (`0005a_org_model.sql:159-161`).
- SmartTransfer **does not** own the post ([ADR-0010](0010-hrms-write-boundary.md)): a transfer engine must not own the
  master it allocates against.
- The four legacy fragments become **derived or retired**: `manpower.plans.filled` and `tenant.positions.filled_strength`
  become derived from `post_occupancy`; `hierarchy.*` is treated as prior art.

## Consequences

- Occupancy and the employee current office change atomically inside HRMS; vacancy becomes a derived count over
  `post_occupancy`, replacing today's text-match on designation name (`reservation/routes.ts:49-59`).
- Backfill must map the three legacy stores into `post` and seed the ledger from current employee rows (ST-M01-08,
  dry-run first).
- Standalone customers get real post/occupancy data without full HRMS; the tables are also the **Mode B** import target
  (STANDALONE §8; [ADR-0023](0023-standalone-packaging.md)).
- Tenure becomes computable from the posting ledger (none exists today; `applyTransferEffect` overwrites the employee
  row, `lifecycle/repo.ts:321-333`).

## Alternatives considered

- **(b) Revive `location-service` `hierarchy.*` and build its writers** — rejected: splits the employee+posting
  transaction across services.
- **(c) SmartTransfer owns posts** — rejected: the allocator must not own its own master (§P04).
