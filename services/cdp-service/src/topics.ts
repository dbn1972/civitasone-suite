/** Topic + event names owned by cdp-service. {service}.{entity}.{action} */
export const COMMANDS = {
  ingestEvent: "cdp.event.ingest",
  resolveIdentity: "cdp.identity.resolve",
  mergeProfiles: "cdp.profile.merge",
  createSegment: "cdp.segment.create",
  updateSegment: "cdp.segment.update",
  deleteSegment: "cdp.segment.delete",
  decideMerge: "cdp.steward.decide",
  /** CDP-001 — append a source-lineage entry to a golden profile. Payload: { profileId, entry }. */
  appendLineage: "cdp.profile.lineage_append",
  /** CDP-003 — one command per event in a near-real-time ingest batch. Payload: { profileId, eventType, payload, occurredAt }. */
  ingestEventBatch: "cdp.event.ingest_batch",
  /** CDP-005 — recompute a segment's materialised membership. Payload: { segmentId }. */
  computeSegment: "cdp.segment.compute",
  /** CDP-007 — link a device token to a profile. Payload: { profileId, deviceToken, deviceType }. */
  linkDevice: "cdp.identity.device_link",
  /** CDP-009 — upsert a predictive score. Payload: { profileId, scoreType, score, modelVersion }. */
  upsertScore: "cdp.profile.score_upsert",
  /** CDP-011 — raise a DSAR. Payload: { dsarId, profileId, requestType }. */
  raiseDsar: "cdp.dsar.raise",
  /** CDP-011 — discharge a DSAR. Payload: { dsarId, profileId, requestType }. */
  completeDsar: "cdp.dsar.complete",
  /** CDP-012 — dispatch a segment to a channel. Payload: { activationId, segmentId, channel, scheduledAt }. */
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
   * CDP-011 — DSAR discharged. Downstream contract: on receipt, segment-service
   * consumers and every activation channel MUST purge the profile from audiences.
   * Payload: { dsarId, profileId, requestType, completedAt }.
   */
  dsarCompleted: "cdp.dsar.completed",
  /** CDP-012 — activation run queued for a channel. Payload: { activationId, segmentId, channel, status }. */
  activationRequested: "cdp.activation.requested",
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {
  /** CRM contact created — may trigger identity resolution. */
  crmContactCreated: "crm.contact.created",
  /** CRM contact updated — may update golden profile attributes. */
  crmContactUpdated: "crm.contact.updated",
} as const;

export const SERVICE = "cdp";
export const RESOURCE = "profile";
