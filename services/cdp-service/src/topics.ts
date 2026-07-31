/** Topic + event names owned by cdp-service. {service}.{entity}.{action} */
export const COMMANDS = {
  ingestEvent: "cdp.event.ingest",
  resolveIdentity: "cdp.identity.resolve",
  mergeProfiles: "cdp.profile.merge",
  createSegment: "cdp.segment.create",
  updateSegment: "cdp.segment.update",
  deleteSegment: "cdp.segment.delete",
  decideMerge: "cdp.steward.decide",
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
