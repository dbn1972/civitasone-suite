import type { MunicipalServiceConfig } from "./types";

export const shopService: MunicipalServiceConfig = {
  serviceKey: "shop",
  moduleKey: "shop",
  label: "Shop & Establishment",
  shortLabel: "Shop",
  icon: "🏪",
  description: "Shop registration, renewal and establishment permits.",
  listPath: "/api/v1/shop/applications",
  resourceLabel: "Applications",
  titleFields: ["establishmentName", "ownerName"],
  numberFields: ["applicationNumber"],
  citizenServiceKey: "shops-establishments",
  sec5: false,
};
