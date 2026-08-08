# Service code querying tables that exist in no database and no migration

**Found:** 2026-08-08 · **Method:** static reference sweep, then verified against
the live staging cluster.

## How this was established

1. Collected every `schema.table` referenced from raw SQL in `services/*/src/**.ts`
   (225 distinct references).
2. Diffed against every `CREATE TABLE|VIEW|MATERIALIZED VIEW|FUNCTION` in
   `services/*/migrations/*.sql`.
3. Took the 12 survivors and searched **all 48 `civitas_*` databases** on the
   deployed staging cluster via `information_schema.tables`.

All 12 came back `NOT FOUND IN ANY DATABASE`. This is observable state, not
inference from the migration files — a table created outside a migration would
still have shown up.

`helpdesk.sla_config` is fixed by this PR. The remaining 11 are recorded below.

## Remaining 11

| Missing table | Referenced from |
|---|---|
| `hrms.employees` | `hrms-service`: id-cards, workforce-planning, device-trust, social, social/pulse, ai-ml/nlu-chatbot, visiting-cards · `report-service`: templates/domain |
| `hrms.holidays` | `hrms-service`: social/pulse, ai-ml/nlu-chatbot |
| `hrms.leave_allocations` | `hrms-service`: social/pulse, ai-ml/nlu-chatbot |
| `hrms.vacancies` | `hrms-service`: ai-ml/recruitment-ai |
| `employee.employee_profiles` | `hrms-service`: workforce-planning |
| `employee.position_budget` | `hrms-service`: workforce-planning |
| `employee.apar_records` | `hrms-service`: ai-predictions |
| `employee.medical_claims` | `hrms-service`: medical |
| `employee.medical_insurance` | `hrms-service`: medical |
| `employee.empanelled_hospitals` | `hrms-service`: medical |
| `geofence.geofences` | `location-service`: map-markers/repo |

## Why these are not fixed here

`helpdesk.sla_config` was fixed because its full schema is derivable from the
queries themselves — column list, types, the composite key the `ON CONFLICT`
upsert requires, and the CHECK constraints implied by the route's own zod
validation. Nothing had to be invented.

These 11 are different. They span whole feature areas (medical claims and
insurance, workforce planning and position budgeting, APAR, ID and visiting
cards, recruitment AI, geofencing). Writing migrations for them means designing
data models from fragmentary SELECT lists, and a guessed schema that *compiles*
is worse than a missing one: it makes a broken feature look delivered and has to
be migrated again once the real model arrives.

They need a product decision per area — **is this feature intended, and what is
its data model?** — before any DDL is written. Several may be unbuilt features
whose routes were scaffolded ahead of the schema, in which case the correct fix
is removing or gating the routes, not adding tables.

## Note on triage

Some of these surface in CI as failing tests that had been read as environment
noise. They are not. Any test asserting that one of these endpoints works is
reporting a real runtime defect.
