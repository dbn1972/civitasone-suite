import type { MunicipalServiceConfig } from "./types";

export const fireService: MunicipalServiceConfig = {
  serviceKey: "fire",
  moduleKey: "fire",
  label: "Fire NOC",
  shortLabel: "Fire",
  icon: "🔥",
  description: "Fire safety NOC applications and field inspections.",
  listPath: "/api/v1/fire/applications",
  resourceLabel: "Applications",
  titleFields: ["buildingName"],
  numberFields: ["applicationNumber"],
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: fire/applications/domain.ts.
  statusVocabulary: ["draft", "submitted", "under_review", "inspection_scheduled", "approved", "rejected", "withdrawn"],
  citizenServiceKey: "fire-noc",
  // W2 PQ-C: service-specific record fields the officer detail panel may show (allow-list, from the
  // fire-service drizzle schema). Blobs (documents/photos), actor UUIDs and raw document numbers stay out.
  displayFields: ["buildingName", "buildingAddress", "occupancyType", "buildingHeight", "numberOfFloors", "builtUpArea", "fireSafetyMeasures", "feePaid"],
  sec5: true,
};
