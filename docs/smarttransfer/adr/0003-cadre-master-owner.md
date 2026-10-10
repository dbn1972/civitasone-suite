# ADR-0003: Cadre master, employee-cadre link and cadre-wise seniority owner

- **Status:** Accepted
- **Decision id:** D-ST-03 (APPROVED, approval log 2026-10-09)
- **Date:** 2026-10-09
- **Deciders:** HR domain owner; programme owner dbn1972 (approved)
- **Spec:** §4; §P02; §P04
- **Related:** [ADR-0001](0001-post-and-occupancy-owner.md), [ADR-0023](0023-standalone-packaging.md)

## Context

Cadre exists today only as **free text** in four unrelated places (M00 §1.2/§1.4, verified on `origin/main`
`9d4fa95e5`): `manpower.plans`, `reservation.hrms_sanctioned_posts`, deputation rosters, and sanctioned-post fragments.
There is no cadre entity, no employee→cadre link, and no cadre-wise seniority. The existing seniority engine keys on
join date, DOB and APAR, not cadre (`hrms-service` `seniority/engine.ts:1-8,63`).

Cadre is a hard-constraint input for allocation (cadre/grade compatibility; spec §7.1) and the basis for partitioning a
100k-employee solve (M00 §7.5). Vacancy today is computed by matching designation **name** to cadre **text**
(`reservation/routes.ts:49-59`), which is unsafe.

## Decision

The **cadre master**, the **employee-cadre link** and **cadre-wise seniority** are owned by **Workforce Core**
(the module profile of `hrms-service`, [ADR-0023](0023-standalone-packaging.md)).

- New `cadre` table (hierarchical via `parent_cadre_id`) with an `external_code` for Mode B mapping, delivered by
  **ST-M01-07**.
- Posts (ADR-0001) reference `cadre_id`, not free text.
- Vacancy and eligibility stop matching on cadre text / designation name.

## Consequences

- Cadre becomes a first-class dimension for eligibility, partitioning and seniority ranking.
- Free-text cadre in the legacy fragments is migrated to `cadre_id` references during backfill (ST-M01-08).
- Cadre-wise seniority is a new computation on top of the existing seniority engine (scope flagged for a later M01/M02
  PR, not ST-M01-05).

## Alternatives considered

- **(b) SmartTransfer-owned cadre** — rejected: cadre is workforce master data, not a movement entity; the allocator
  must not own the masters it allocates against (§P04, consistent with [ADR-0001](0001-post-and-occupancy-owner.md)).
