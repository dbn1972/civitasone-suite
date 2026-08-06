# segments — customer-segment taxonomy (G5)

Turns `crm.contacts.segment` from an ungoverned free-text string into an optional,
per-tenant **catalogue**, and models the part of the product spec that was previously
missing entirely: each segment's **priority products** (ordered) and **primary
channels**.

## Why

`crm.contacts.segment` is a `varchar(64)` written by the LQ-003 classification command
(`PATCH /v1/crm/contacts/:id/classification`). At national scale free text produces
`Enterprise`, `enterprise`, `ENT`, `entrprise` — none of which aggregate. And the
priority-product / primary-channel mapping that should drive recommendation eligibility
and channel selection had no home at all.

## What it does NOT do

- It does **not** change `crm.contacts.segment`. The column keeps its type, its name and
  every value already in it.
- It does **not** enforce anything by default. Enforcement is a per-tenant switch that
  defaults to **false**, and a tenant with no settings row is a tenant with enforcement
  off. See "Backward compatibility" below.
- It seeds **no** segments. A reference taxonomy (India Post's eight segments, a
  telecom's five, whatever a deployment uses) is *tenant configuration* and is loaded as
  seed data, never from a platform migration — see "Seeding your catalogue".

## Tables

| Table | Purpose |
|---|---|
| `crm.segment_definitions` | One row per `(tenant_id, segment_code)`. Standard entity columns plus `display_name`, `description`, `governance`, `priority_products` (JSONB, ordered), `primary_channels` (JSONB), `status`, `version_number`, `published_at`, `deprecated_at`, `deleted_at`. Migration `0086`. |
| `crm.segment_settings` | `tenant_id` PK + `enforce_segment_catalogue boolean NOT NULL DEFAULT false`. Migration `0087`. Mirrors the existing `crm.deal_close_policy` mechanism for per-tenant policy. |

### Lifecycle

```
draft ──publish──► published ──deprecate──► deprecated ──publish──► published
```

Only `published` segments are eligible for recommendations and only published codes are
accepted under catalogue enforcement. Publishing bumps `version_number` — the taxonomy
revision a consumer can quote — and stamps `published_at`.

### Governance: canonical rows are immutable

`governance = 'canonical'` marks reference data delivered as seed. Update, delete,
publish and deprecate all answer **422 `SEGMENT_CANONICAL_IMMUTABLE`** for such a row,
**regardless of the caller's role** — role is deliberately not consulted, so a
platform-wide catalogue cannot diverge tenant by tenant through one admin's mistake. A
tenant that needs something different creates its own `governance = 'tenant'` segment.

### Channels are not a new vocabulary

`primary_channels` values come from `src/modules/leads/channels.ts` — the single channel
list the inbound lead-capture route already validates against and which is persisted on
`crm.contacts.capture_channel`. It is enforced twice: `z.enum(LEAD_CHANNELS)` at the
route, and a JSONB containment CHECK in migration `0086`. Adding a channel is one line
in `channels.ts` plus that CHECK.

## Routes

All under `/v1/crm/`, kebab-case paths, camelCase JSON. Mutations follow the service's
CQRS rule — validate with zod, `queue.publish`, return **202**; the write happens in
`consumer.ts` (`markProcessed` first, then the write, then the outbox event + audit
event, then cache invalidation). Reads go through `cache.getOrLoad`.

| Method | Path | Roles | Notes |
|---|---|---|---|
| `GET` | `/v1/crm/segments` | read | `{ data, meta: { page, pageSize, total } }`; filters `status`, `governance` |
| `POST` | `/v1/crm/segments` | admin | creates a **draft**; 409 if the code exists (including a soft-deleted one) |
| `GET` | `/v1/crm/segments/settings` | read | `{ data: { enforceSegmentCatalogue, ... } }` |
| `PUT` | `/v1/crm/segments/settings` | admin | flips enforcement |
| `GET` | `/v1/crm/segments/:segmentCode` | read | 404 if unknown |
| `PATCH` | `/v1/crm/segments/:segmentCode` | admin | requires `version`; 409 on conflict, 422 if canonical |
| `DELETE` | `/v1/crm/segments/:segmentCode` | admin | soft-delete; 422 if canonical |
| `POST` | `/v1/crm/segments/:segmentCode/publish` | admin | 422 if already published or canonical |
| `POST` | `/v1/crm/segments/:segmentCode/deprecate` | admin | 422 unless published |
| `GET` | `/v1/crm/segments/:segmentCode/eligibility` | read | the contract below; 404 unknown **or** unpublished |

read = `crm_user`, `crm_admin`, `tenant_admin`, `super_admin`.
admin = `crm_admin`, `tenant_admin`, `super_admin`.

## The eligibility contract (consumed by recommendation-service)

`GET /v1/crm/segments/{segmentCode}/eligibility` → `200`

```json
{
  "data": {
    "segmentCode": "SMALL_BUSINESS",
    "displayName": "Small Business",
    "status": "published",
    "versionNumber": 3,
    "priorityProducts": ["PARCEL_EXPRESS", "LOGISTICS_POST", "BUSINESS_PARCEL"],
    "primaryChannels": ["email", "telephony"],
    "publishedAt": "2026-07-05T09:12:44.123Z"
  }
}
```

Stability guarantees for consumers:

- **`priorityProducts` is ordered.** Index 0 is the highest-priority product. The order
  is exactly what an admin configured; nothing re-sorts it.
- **`primaryChannels` is ordered.** Index 0 is the channel to try first. Values are
  always from the service's channel vocabulary.
- **Published only.** A draft or deprecated segment answers `404`, so a consumer never
  has to decide whether a segment is "live" — if it got a `200`, it is.
- **Additive evolution.** Fields are only added, never removed or renamed. A consumer
  should ignore unknown fields.
- **`versionNumber`** identifies the taxonomy revision, so a recommendation can record
  which revision it scored against.
- `404` carries code `SEGMENT_NOT_FOUND`; the envelope is the service standard
  `{ code, message, correlationId, retryable }`.

## Backward compatibility (the risky part, and how it is held)

`crm.contacts.segment` already holds free text for live tenants, and the project's rules
forbid removing or renaming existing fields or breaking existing data. So:

1. The column is untouched — same name, same `varchar(64)`, same values.
2. Enforcement is a per-tenant switch, `crm.segment_settings.enforce_segment_catalogue`,
   defaulting to **false**. A tenant with **no row** reads as false.
3. With enforcement **off**, `assertSegmentAllowed()` returns before reading the
   catalogue at all, so `PATCH /v1/crm/contacts/:id/classification` behaves exactly as it
   did — any free-text value is accepted, including values that are not in any catalogue.
4. With enforcement **on**, a `segment` value that is not a published `segmentCode` is
   refused with **422 `SEGMENT_NOT_IN_CATALOGUE`** and a message listing the valid codes.
   Clearing the segment (`null`) is always allowed: enforcement governs the vocabulary,
   not whether a lead must be segmented.

Proved by `tests/segments-enforcement.test.ts`, which asserts the default-off path is
unchanged (including that values that would be rejected under enforcement are still
accepted) and that flipping the switch rejects unknown codes and accepts published ones.

## Seeding your catalogue

Deliberately **not** in a migration — a platform migration that inserted one
organisation's segments would be hardcoded tenant-specific logic. Load your reference
segments per tenant through the API instead:

```bash
# 1. create + publish each segment (governance defaults to "tenant";
#    a platform seeding tool may pass "governance": "canonical" to make the
#    row immutable through the API afterwards)
curl -X POST "$GW/api/v1/crm/segments" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -H "x-idempotency-key: seed-small-business" \
  -d '{"segmentCode":"SMALL_BUSINESS","displayName":"Small Business",
       "priorityProducts":["PARCEL_EXPRESS","LOGISTICS_POST"],
       "primaryChannels":["email","telephony"]}'

curl -X POST "$GW/api/v1/crm/segments/SMALL_BUSINESS/publish" \
  -H "authorization: Bearer $TOKEN"

# 2. only once the catalogue is complete, turn enforcement on for that tenant
curl -X PUT "$GW/api/v1/crm/segments/settings" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"enforceSegmentCatalogue":true}'
```

Enforcement should be flipped **after** seeding, otherwise the first classification with
a legacy value is refused before the replacement code exists.

## Topics

Commands (`crm.segment_definition.create|update|delete|publish|deprecate`,
`crm.segment_settings.set`) and events
(`crm.segment_definition.created|updated|deleted|published|deprecated`,
`crm.segment_settings.settings_updated`) are documented with payload shapes and firing
conditions in `src/topics.ts`. Every mutation also enqueues an `audit.event.record`
outbox event in the same transaction; refused transitions are audited with a non-success
outcome rather than disappearing.

## Files

| File | Contents |
|---|---|
| `schema.ts` | Drizzle tables + view/contract types |
| `domain.ts` | Pure logic: transitions, canonical immutability, channel/product checks, the enforcement decision, eligibility projection |
| `validators.ts` | zod schemas for every route boundary |
| `commands.ts` | Command publishers (+ pre-emptive cache invalidation) |
| `consumer.ts` | `markProcessed` → write → outbox event + audit → cache invalidate |
| `repo.ts` | RLS-scoped reads and guarded, version-checked writes |
| `queries.ts` | Cached read models + `assertSegmentAllowed()` |
| `routes.ts` | HTTP surface |
