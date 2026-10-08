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
  sec5: true,
};
