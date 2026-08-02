/**
 * metadata-service queue topics.
 *
 * Convention used across the suite:
 *   COMMANDS — imperative, "someone MUST do this". A command without a
 *              subscriber is a silently dropped write, so a command is only
 *              declared here once its consumer exists.
 *   EVENTS   — declarative, "this happened". An event with no subscriber is
 *              legitimate: it is a durable statement of fact that later
 *              consumers can subscribe to without the publisher changing.
 */

export const COMMANDS = {
  /**
   * `metadata.entity.create` — create a custom entity definition.
   * Published by: modules/entities/routes.ts (POST /v1/metadata/entities).
   * Consumed by: modules/entities/consumer.ts (this service).
   * Payload: `{ id, tenantId, apiName, label, pluralLabel, description?, icon? }`.
   */
  ENTITY_CREATE: "metadata.entity.create",

  /**
   * `metadata.entity.update` — patch a custom entity definition.
   * Published by: modules/entities/routes.ts (PATCH /v1/metadata/entities/:id).
   * Consumed by: modules/entities/consumer.ts (this service).
   * Payload: `{ id, tenantId, label?, pluralLabel?, description?, isActive? }`.
   */
  ENTITY_UPDATE: "metadata.entity.update",
} as const;

export const EVENTS = {
  /**
   * `metadata.lead.captured` — a lead was captured from a public web form,
   * together with its UTM attribution (LM-002).
   *
   * WHEN IT FIRES
   *   Emitted through the transactional outbox in the SAME transaction that
   *   inserts `metadata.form_submissions`, from the unauthenticated endpoint
   *   `POST /v1/metadata/public/tenants/:tenantId/forms/:formKey/submissions`
   *   (see modules/forms/public-routes.ts). "DB committed ⇒ event delivered":
   *   there is no dual-write hole. Exactly one event per persisted submission;
   *   the relay may re-deliver on crash, so consumers must dedupe on
   *   `messageId` via `markProcessed`.
   *
   * PAYLOAD SHAPE
   *   {
   *     submissionId:  string (uuid)   — metadata.form_submissions.id
   *     formVersionId: string (uuid)   — the published form version submitted against
   *     tenantId:      string (uuid)   — resolved server-side from the URL, never from the body
   *     channel:       "public_web_form"
   *     capturedAt:    string (ISO-8601 timestamptz)
   *     utm: {                          — every key optional; absent when not supplied
   *       source?: string, medium?: string, campaign?: string,
   *       term?: string,   content?: string
   *     }
   *     answerFieldCount: number       — how many answers were kept after hidden-field stripping
   *     hasEmail: boolean              — whether an email was captured
   *     hasPhone: boolean              — whether a phone number was captured
   *   }
   *
   * DELIBERATELY ABSENT FROM THE PAYLOAD: the lead's name, email, phone and
   * answers. Those are DPDP-protected PII, encrypted at rest, and the queue is
   * not an encrypted store. A consumer that needs them must read them back
   * through this service's authenticated submission API, which is auditable.
   * `hasEmail`/`hasPhone` exist so a consumer can route on contactability
   * without the values themselves.
   *
   * SUBSCRIBERS
   *   None yet. The RTM pairs LM-002 with crm-service, but the crm-side lead
   *   ingest does not exist and is out of this lane's scope. This is published
   *   as an EVENT precisely so that is safe: nothing is waiting on it, no work
   *   is dropped, and a crm-service consumer can be added later with no change
   *   here. Adding that consumer is a tracked follow-up.
   */
  LEAD_CAPTURED: "metadata.lead.captured",

  /**
   * `metadata.form-version.published` — a form version passed maker-checker
   * approval and is now the live definition for its form (FRM-07).
   *
   * WHEN IT FIRES
   *   Through the outbox, in the same transaction as the status transition in
   *   `POST /v1/metadata/form-versions/:id/approve`. Fires once per version; a
   *   repeat approve is refused 409 before any event is written.
   *
   * PAYLOAD SHAPE
   *   {
   *     formVersionId:  string (uuid)
   *     layoutDefId:    string (uuid)  — the form (metadata.layout_definitions.id)
   *     tenantId:       string (uuid)
   *     versionNumber:  number         — monotonically increasing per form
   *     submittedBy:    string (uuid)  — the maker
   *     approvedBy:     string (uuid)  — the checker; guaranteed !== submittedBy
   *     supersededVersionId: string (uuid) | null — the version this replaced
   *     publishedAt:    string (ISO-8601 timestamptz)
   *   }
   *
   * SUBSCRIBERS
   *   None yet. Consumers that cache form definitions (web app, portal) can
   *   subscribe to invalidate on publish.
   */
  FORM_VERSION_PUBLISHED: "metadata.form-version.published",
} as const;

/** Events this service consumes from other services. */
export const CONSUMED_EVENTS = {
  /**
   * `audit.event.record` — not consumed, but published by every mutation path
   * in this service (see modules/entities/consumer.ts and
   * modules/forms/*-routes.ts). Owned by audit-service; listed here so the
   * contract is discoverable from the publisher side.
   */
  AUDIT_RECORD: "audit.event.record",
} as const;

/** Well-known actor id used for writes with no authenticated actor (public forms). */
export const ANONYMOUS_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
