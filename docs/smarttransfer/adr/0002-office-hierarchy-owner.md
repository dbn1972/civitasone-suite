# ADR-0002: Canonical office / department hierarchy owner

- **Status:** Accepted
- **Decision id:** D-ST-02 (APPROVED, approval log 2026-10-09)
- **Date:** 2026-10-09
- **Deciders:** HR domain owner; programme owner dbn1972 (approved)
- **Spec:** §4; §11.2 (establishment); §P02; §P04
- **Related:** [ADR-0001](0001-post-and-occupancy-owner.md), [ADR-0023](0023-standalone-packaging.md)

## Context

Three unrelated trees exist today (M00 §1.2, verified on `origin/main` `9d4fa95e5`):

- `employee.hrms_departments` — used by employees, transfers and manpower (`hrms-service` `employee/schema.ts:8-25`).
- `tenant.org_units` — a separate org-unit tree (`tenant-service` `org-hierarchy/schema.ts:5-20`), unrelated to the HRMS tree.
- `hierarchy.offices` + LGD admin units — a schema and read resolver with **no writers** (`location-service`
  `hierarchy/org-schema.ts`, migration `0005a`).

There is precedent for consolidating onto the HRMS tree: estab migration `0027` already dropped its own tree in favour
of HRMS departments (M00 D-ST-02). Posts and occupancy (ADR-0001) need a canonical office dimension to attach to.

A known limitation: `employee.hrms_departments` **conflates department and office** (STANDALONE §8), so postings need an
explicit office node or office flag. The precise office-type vocabulary is left to the ST-M01-07 design.

## Decision

The canonical **office / department hierarchy** is owned by **Workforce Core** (the HRMS departments tree), with a
**mapping to LGD / location admin units** by `location_id`.

- Posts (ADR-0001) attach to an **office** node of this tree.
- Geographic jurisdiction stays in `location-service` and is mapped to office nodes, not merged into them.
- **Mode B import** writes into the Workforce Core departments tree, or into `tenant.org_units` with a mapping table —
  which is decided by [ADR-0023](0023-standalone-packaging.md). Today the only working import writes `tenant.org_units`
  (`tenant-service` `org-hierarchy/routes.ts:123`), so M01 must settle this import path.

## Consequences

- One canonical office tree for posts, occupancy, jurisdiction scoping and the command-centre establishment screens
  (spec §10 screen 3).
- An office node type or flag must be added to the department vocabulary (`employee/dept-domain.ts`); scoped to ST-M01-07.
- `tenant.org_units` and `hierarchy.offices` become mapped/derived or legacy, not a second source of truth (§P02).

## Alternatives considered

- **(b) `tenant.org_units` as owner** — rejected: not used by employees or transfers; would duplicate the HRMS tree.
- **(c) `location.offices` as owner** — rejected: schema + read resolver only, no writers; would require building a
  whole writer stack and still split from the employee row.
