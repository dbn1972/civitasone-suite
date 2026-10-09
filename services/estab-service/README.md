# estab-service

Establishment / eOffice backend (SVC-058…061). Fastify + Drizzle, one Postgres
schema per bounded-context module under `src/modules/<module>/`.

## Intentionally headless route groups (no estab web UI by design)

Several registered route groups have **no screen in the estab web unit**
(`apps/web/src/app/(app)/estab`). This is deliberate, not an oversight. They
are recorded here so "implemented but unreachable from this unit" is an
explicit, reviewed decision rather than silent ambiguity
(GAP2-ESTAB-ESIGN-ORPHAN-UI-01).

| Route group | Status | Why no estab-unit screen |
|---|---|---|
| `/v1/estab/esign/*` | headless (server-to-server) | Drives the files/noting signing workflow; invoked by the files UI + consumers, not a standalone screen. |
| `/v1/estab/records*` | headless (server-to-server) | Records-management / retention / weed-out support for the files workflow; surfaced inside the files screens, no dedicated page. |
| `/v1/estab/correspondence*` | headless (server-to-server) | Correspondence (yellow-side) + PUC marking against a file; surfaced within the files screens. |
| `/v1/estab/referencing*` | headless (server-to-server) | Structured referencing between files; surfaced within the files screens. |
| `/v1/estab/spaces*` | headless (surfaced elsewhere) | Seat/building allotment is intended for the facilities/space-management unit and mobile, not the estab eOffice unit. |
| `/v1/estab/consumables/*` | headless (surfaced elsewhere) | Office-consumables inventory is intended for the inventory/facilities unit, not the estab eOffice unit. |
| `/v1/estab/court-cases`, `/v1/estab/rti` | headless (surfaced elsewhere) | Legal case + RTI tracking is intended for the legal unit's web screens; RTI intake also arrives via `citizen.rti.filed`. |
| `/v1/estab/booking/*` | headless (surfaced elsewhere) | Facility-booking CRUD/workflow is intended for a citizen-facing / facilities unit. Registered + consumer-backed as of GAP2-ESTAB-BOOKING-ORPHAN-01 (previously an unmounted orphan). |
| `/v1/estab/citizen-lease/*` | headless (surfaced elsewhere) | Municipal property leasing is intended for a citizen-facing / estate unit. Registered + consumer-backed as of GAP2-ESTAB-BOOKING-ORPHAN-01. |

If any of the above later needs an estab-local screen, add it under
`apps/web/src/app/(app)/estab/<group>` and move the row out of this table.

## Modules with estab web screens

`files`, `committee`/`meetings`, `assets`/`vehicles`, `facilities`/`guesthouse`,
`dashboard`, `approval-rules`/`approval-matrix`, `dfa`, `handover`, `migration`,
`operators`, `notifications`, `quarters`, `fleet`, `library`, `dak`/`dispatch`.
