# crm-service — `checklists` module (G7)

Checklist-driven cases for the three product journeys that need one:

- **exporter readiness** — IEC / AD-code guidance,
- **insurance proposal** — medical and verification requirements,
- **B2B customer onboarding**.

Before this module, `crm.onboarding_cases` carried only `stage` + `kycStatus` and CRM had
no checklist capability at all.

## Design

All scoring, conditional visibility, section prerequisites and completion logic comes from
**`@civitasone/checklist`** and is not reimplemented here. An equivalent engine already
exists in `services/inspection-service/src/modules/checklist`; module isolation means CRM
cannot import it, so the pure part was extracted into a shared package rather than copied
a second time. This module owns only what is CRM's: storage, the HTTP surface, the two
status machines, and the CQRS write path.

Two invariants drive the whole design:

1. **Templates are versioned by row.** A published template is never destructively
   edited — instances reference its structure, and editing it in place would rewrite what
   an in-flight case was asked. Amending means inserting a new row with the same
   `templateKey` and `versionNumber + 1`. Publishing version N deprecates version N-1 in
   the same transaction, and a partial unique index enforces at most one published version
   per key.
2. **Instances freeze their structure.** An instance holds a deep copy of the published
   template's sections, taken at creation. A template published next month cannot
   retroactively change an in-flight case.

## Tables

### `crm.checklist_templates` (migration 0083)

`id`, `tenantId`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `version` (optimistic
lock) plus `templateKey`, `name`, `description`, `sections` (JSONB), `versionNumber`,
`status` (`draft | published | deprecated`), `publishedAt`.

Unique on `(tenantId, templateKey, versionNumber)`; partial unique on
`(tenantId, templateKey) WHERE status = 'published'` (migration 0085).

### `crm.checklist_instances` (migration 0084)

Standard entity columns plus `subjectType`
(`onboarding_case | deal | contact | account`), `subjectId`, `templateId`, `templateKey`,
`templateVersionNumber`, `structure` (JSONB — the frozen copy), `responses` (JSONB),
`status` (`in_progress | completed | cancelled`), `score`, `completedAt`.

Partial unique on `(tenantId, subjectType, subjectId, templateKey) WHERE status =
'in_progress'`: one live checklist per subject per key.

`subjectId` is opaque. This module never joins to onboarding / deals / contacts /
accounts — it records what it was told to attach to.

## Routes

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/crm/checklist-templates` | filters: `templateKey`, `status`; paginated |
| POST | `/v1/crm/checklist-templates` | create a DRAFT version → 202 |
| GET | `/v1/crm/checklist-templates/:id` | |
| PATCH | `/v1/crm/checklist-templates/:id` | DRAFT only → 202 |
| POST | `/v1/crm/checklist-templates/:id/publish` | → 202 |
| POST | `/v1/crm/checklist-templates/:id/deprecate` | → 202 |
| GET | `/v1/crm/checklist-instances` | filters: `subjectType`, `subjectId`, `status`, `templateKey` |
| POST | `/v1/crm/checklist-instances` | from `templateId` or `templateKey` → 202 |
| GET | `/v1/crm/checklist-instances/:id` | |
| POST | `/v1/crm/checklist-instances/:id/responses` | partial saves allowed → 202 |
| GET | `/v1/crm/checklist-instances/:id/completion` | progress, outstanding items, score |

Reads: `crm_user`, `crm_admin`, `tenant_admin`, `super_admin`. Template authoring:
`crm_admin`, `tenant_admin`, `super_admin` — a checklist decides what every customer in
the tenant is asked, so it is configuration, not sales work.

Status codes beyond the usual: `409 VERSION_CONFLICT` (stale optimistic lock),
`409 OPEN_INSTANCE_EXISTS`, `422 TEMPLATE_IMMUTABLE`, `422 TEMPLATE_EMPTY`,
`422 TEMPLATE_NOT_PUBLISHED`, `422 INSTANCE_NOT_OPEN`, `400 UNKNOWN_QUESTION`, and the
shared engine's structural codes (`DUPLICATE_QUESTION_IDS`, `PREREQUISITE_CYCLE`,
`UNKNOWN_CONDITION_DEPENDENCY`, …) as 400.

## Commands and events

Commands (`src/topics.ts`): `crm.checklist_template.create | update | publish |
deprecate`, `crm.checklist_instance.create`, `crm.checklist_instance.submit_responses`.

Events: `crm.checklist_template.created | updated | published | deprecated`,
`crm.checklist_instance.created`, `crm.checklist_item.answered`,
`crm.checklist_instance.completed`.

**No event carries answer content.** An answer value can be personal data (a medical
declaration, an identifier), and an event fans out to every subscriber and their logs.
`crm.checklist_item.answered` carries the answered question IDs plus progress and score;
the values stay in the row. `crm.checklist_instance.submit_responses` is the one topic that
carries values, deliberately narrow, and its consumer is the only reader.

The events are **not coupled to onboarding**. This module emits the facts and lets
onboarding (or any future journey) subscribe later.

## Write path

Routes validate with zod, publish a command, return 202. Nothing here writes to Postgres.
Each consumer: `markProcessed(messageId)` first → guarded write → outbox event + audit →
cache invalidate after commit. Every guarded write that matches nothing emits an audit
record explaining why (`rejected_not_found`, `rejected_stale_state`,
`rejected_status_published`, `rejected_open_instance_exists`, …) rather than vanishing.

Completion is **derived**, never asserted by the caller: an instance becomes `completed`
exactly when nothing required, visible and unlocked is outstanding.

## Dependencies

`@civitasone/checklist` (pure engine), `@civitasone/schemas` (zod + 202 envelope),
`@civitasone/cache`, `@civitasone/queue`, `@civitasone/outbox`, `@civitasone/auth`,
`@civitasone/db`, `drizzle-orm`, `zod`, `pino`.

## Tests

- `services/crm-service/tests/g7-checklists-domain.test.ts` — status machines,
  publishability, version numbering, delegation to the shared engine.
- `services/crm-service/tests/g7-checklists.test.ts` — every endpoint (happy path + 400 +
  401 + 403 + 404), versioning, structure freezing, partial saves, completion, consumer
  guards and idempotency, tenant isolation, and a PII assertion over the emitted events.
- `packages/checklist/tests/` — the engine itself, including the three journeys.
