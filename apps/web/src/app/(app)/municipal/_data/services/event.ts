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
  citizenServiceKey: "event-permission",
  sec5: true,
};
