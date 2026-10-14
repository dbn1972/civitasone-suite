import type { MunicipalServiceConfig } from "./types";

export const eventService: MunicipalServiceConfig = {
  serviceKey: "event",
  moduleKey: "event",
  label: "Public Event",
  shortLabel: "Event",
  icon: "🎪",
  description: "Public event permission and post-event compliance.",
  listPath: "/api/v1/event/applications",
  resourceLabel: "Applications",
  titleFields: ["venueName", "organiserName"],
  numberFields: ["applicationNumber"],
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: event/applications/domain.ts.
  statusVocabulary: ["draft", "submitted", "noc_pending", "nocs_received", "approved", "rejected", "permitted", "completed", "withdrawn"],
  citizenServiceKey: "event-permission",
  // W2 PQ-C: service-specific record fields the officer detail panel may show (allow-list, from the
  // event-service drizzle schema). Blobs (documents/photos), actor UUIDs and raw document numbers stay out.
  displayFields: ["organiserName", "organiserOrg", "eventType", "venueName", "venueAddress", "expectedAttendance", "temporaryStructures", "soundPermission"],
  sec5: true,
};
