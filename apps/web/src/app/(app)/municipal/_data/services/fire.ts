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
  citizenServiceKey: "fire-noc",
  sec5: true,
};
