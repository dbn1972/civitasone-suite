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
  sec5: true,
};
