/** Topic + event names owned by cdp-service. {service}.{entity}.{action} */
export const COMMANDS = {
  ingestEvent: "cdp.event.ingest",
  resolveIdentity: "cdp.identity.resolve",
  mergeProfiles: "cdp.profile.merge",
  createSegment: "cdp.segment.create",
  updateSegment: "cdp.segment.update",
  deleteSegment: "cdp.segment.delete",
  decideMerge: "cdp.steward.decide",
  /**
   * CDP-003 — one command per event in a near-real-time ingest batch.
   * Payload: { profileId, eventType, payload, occurredAt, source? }.
   * Consumed by modules/events/consumer.ts, which performs the authoritative
   * event-store write: the ingest route publishes only, it never writes.
   */
  ingestEventBatch: "cdp.event.ingest_batch",
  /**
   * CDP-005 — post-recompute fan-out. Payload: { segmentId, memberCount, computedAt }.
   * Consumed by modules/segments/consumer.ts. The membership recompute itself is done
   * synchronously by the route; this command carries only the follow-up work
   * (refreshing the audience snapshot of activations that have not dispatched yet).
   */
  computeSegment: "cdp.segment.compute",
  /**
   * CDP-011 — raise a DSAR. Payload: { dsarId, profileId, requestType }.
   * Consumed by modules/dsar/consumer.ts, which performs the fulfilment work the route
   * defers (status → in_progress plus the purge of the cdp-owned data it covers).
   */
  raiseDsar: "cdp.dsar.raise",
  /** CDP-011 — discharge a DSAR. Payload: { dsarId, profileId, requestType }. */
  completeDsar: "cdp.dsar.complete",
  /**
   * CDP-012 — dispatch a segment to a channel.
   * Payload: { activationId, segmentId, channel, audienceCount, dispatchAt }.
   * Consumed by modules/activations/consumer.ts, which hands the run to the channel.
   */
  activateSegment: "cdp.segment.activate",
} as const;

export const EVENTS = {
  eventIngested: "cdp.event.ingested",
  identityResolved: "cdp.identity.resolved",
  profilesMerged: "cdp.profile.merged",
  profileCreated: "cdp.profile.created",
  profileUpdated: "cdp.profile.updated",
  segmentCreated: "cdp.segment.created",
  segmentUpdated: "cdp.segment.updated",
  segmentDeleted: "cdp.segment.deleted",
  mergeDecided: "cdp.steward.merge_decided",
  /** CDP-001 — lineage entry appended. Payload: { profileId, entry: { source, sourceId, timestamp } }. */
  lineageAppended: "cdp.profile.lineage_appended",
  /** CDP-004 — a taxonomy definition was registered. Payload: { taxonomyId, eventName, category }. */
  taxonomyCreated: "cdp.event_taxonomy.created",
  /** CDP-004 — a taxonomy definition changed. Payload: { taxonomyId, patch }. */
  taxonomyUpdated: "cdp.event_taxonomy.updated",
  /** CDP-004 — a taxonomy definition became publishable. Payload: { taxonomyId, eventName }. */
  taxonomyApproved: "cdp.event_taxonomy.approved",
  /** CDP-005 — membership recomputed. Payload: { segmentId, memberCount }. */
  segmentComputed: "cdp.segment.computed",
  /** CDP-007 — device token linked to a profile. Payload: { profileId, deviceType }. Never carries the token. */
  deviceLinked: "cdp.identity.device_linked",
  /** CDP-009 — predictive score stored. Payload: { profileId, scoreType, score, modelVersion }. */
  scoreUpserted: "cdp.profile.score_upserted",
  /** CDP-011 — DSAR received. Payload: { dsarId, profileId, requestType, status }. */
  dsarRaised: "cdp.dsar.raised",
  /**
   * CDP-011 — DSAR fulfilment started and the cdp-owned identifier/audience data covered
   * by the request was purged. Payload: { dsarId, profileId, requestType, status,
   * purgeDownstream, purged: { deviceTokens, identityLinks, memberships } }.
   */
  dsarInProgress: "cdp.dsar.in_progress",
  /**
   * CDP-011 — DSAR discharged. Downstream contract: on receipt, segment-service
   * consumers and every activation channel MUST purge the profile from audiences.
   * Payload: { dsarId, profileId, requestType, completedAt }.
   */
  dsarCompleted: "cdp.dsar.completed",
  /** CDP-012 — activation run queued for a channel. Payload: { activationId, segmentId, channel, status }. */
  activationRequested: "cdp.activation.requested",
  /**
   * CDP-012 — an activation run has been handed to its channel.
   * Downstream contract: the channel adapter for `channel` pulls the audience from
   * GET /v1/cdp/segments/{segmentId}/members and performs delivery. CDP does not own
   * channel delivery, so this event — not a per-recipient message — is the dispatch.
   * Payload: { activationId, segmentId, channel, audienceCount, dispatchedAt }.
   */
  activationDispatched: "cdp.activation.dispatched",
  /**
   * CDP-005/012 — the audience snapshot of not-yet-dispatched activation runs was
   * refreshed after a segment recompute. Payload: { segmentId, memberCount, activationIds }.
   */
  activationAudienceRefreshed: "cdp.activation.audience_refreshed",

  /**
   * CR-CDP-01 — a vertical profile template was registered. Fires on
   * POST /v1/cdp/profile-templates, inside the same transaction as the insert.
   * Payload: { templateId, vertical, profileType, attributeCount }.
   */
  profileTemplateCreated: "cdp.profile_template.created",
  /**
   * CR-CDP-01 — a template's attribute contract or conflict rules changed. Fires on
   * PATCH /v1/cdp/profile-templates/{id}. Downstream contract: a consumer holding
   * template-derived state should re-read the template.
   * Payload: { templateId, vertical, changed: string[] } — field names only, no values.
   */
  profileTemplateUpdated: "cdp.profile_template.updated",
  /**
   * CR-CDP-01 — a template's conflict rules were applied to a golden profile and the
   * surviving attributes were written. Fires on POST /v1/cdp/profiles/{id}/apply-template.
   * Payload: { profileId, templateId, vertical,
   *            resolved: Array<{ attribute, source, strategy, conflicted }>,
   *            ignoredAttributes: string[] }.
   * Attribute NAMES and the winning source only — never the values, which are PII.
   */
  profileTemplateApplied: "cdp.profile.template_applied",

  /**
   * CR-CDP-02 — a profile's phonetic name key was (re)indexed for approximate matching.
   * Fires on POST /v1/cdp/identity/name-keys. Payload: { profileId, phoneticKey, reindexed }.
   * The phoneticKey is a lossy Soundex code, not the name; the normalized name is PII and
   * is deliberately absent.
   */
  nameKeyIndexed: "cdp.identity.name_key_indexed",

  /**
   * CR-CDP-03 — a new revision of an event's attribute schema was authored as a draft.
   * Fires on POST /v1/cdp/events/taxonomy/{id}/versions.
   * Payload: { taxonomyId, eventName, schemaVersion, breaking } — `breaking` is true when
   * a producer satisfying the previous revision could fail this one.
   */
  taxonomyVersionCreated: "cdp.event_taxonomy_version.created",
  /**
   * CR-CDP-03 — a schema revision is now the contract in force; its predecessor was
   * deprecated in the same transaction. Downstream contract: producers should validate
   * against this schemaVersion from now on.
   * Payload: { taxonomyId, eventName, schemaVersion, deprecatedCount }.
   */
  taxonomyVersionActivated: "cdp.event_taxonomy_version.activated",
  /**
   * CR-CDP-03 — a schema revision was retired. Historical events remain explicable
   * against it; new payloads should not be validated against it.
   * Payload: { taxonomyId, eventName, schemaVersion }.
   */
  taxonomyVersionDeprecated: "cdp.event_taxonomy_version.deprecated",

  /**
   * CR-CDP-04 — an anonymous visitor (device/cookie id) was registered with a shell
   * golden profile. Fires on the first POST /v1/cdp/identity/anonymous-visitors for a
   * visitor key; a returning visitor is a heartbeat and emits nothing.
   * Payload: { visitorId, anonymousProfileId, deviceType }. Carries no visitor key,
   * raw or hashed — a hashed device id is still a tracking identifier.
   */
  visitorTracked: "cdp.identity.visitor_tracked",
  /**
   * CR-CDP-04 — an anonymous visitor authenticated and its events, identifiers and
   * devices were merged into the known golden profile. Fires on
   * POST /v1/cdp/identity/anonymous-visitors/{id}/stitch, alongside `cdp.profile.merged`
   * (so existing merge consumers stay correct without learning a new topic) and
   * `cdp.profile.lineage_appended`.
   * Payload: { visitorId, anonymousProfileId, knownProfileId, eventsMerged,
   *            identifiersMerged, devicesMerged }.
   */
  visitorStitched: "cdp.identity.visitor_stitched",
} as const;

/**
 * Topics consumed from other services (cross-service stitching).
 *
 * crm-service owns both payload shapes below, so both are validated on read and missing
 * optional fields are tolerated — a foreign publisher must not be able to wedge this
 * consumer. Neither handler logs any payload field other than ids: these events carry
 * contact names.
 */
export const CONSUMED_EVENTS = {
  /**
   * CRM contact created → identity resolution (modules/identity/crm-consumer.ts).
   * Guaranteed: { contactId: uuid }. Optional: { name, email, phone, city, company,
   * country }. crm-service reuses this topic for bulk-import summaries
   * ({ batchId, total, ... }), which carry no contactId and are skipped.
   *
   * Resolution is deterministic on hashed email/phone: a match links the contact to the
   * existing golden profile and emits `cdp.identity.resolved` (outcome "linked"), no match
   * creates a golden profile and emits `cdp.profile.created`, and a split match (email and
   * phone pointing at different profiles) writes nothing and is left for the steward queue.
   */
  crmContactCreated: "crm.contact.created",
  /**
   * CRM contact updated → golden profile attribute refresh (modules/identity/crm-consumer.ts).
   * Guaranteed: { contactId: uuid }. Optional: { name, email, phone, city, company,
   * country, mergedFrom }.
   */
  crmContactUpdated: "crm.contact.updated",
} as const;

export const SERVICE = "cdp";
export const RESOURCE = "profile";
