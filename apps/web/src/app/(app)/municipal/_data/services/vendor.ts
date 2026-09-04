import type { MunicipalServiceConfig } from "./types";

export const vendorService: MunicipalServiceConfig = {
  serviceKey: "vendor",
  moduleKey: "vendor",
  label: "Street Vendor",
  shortLabel: "Vendor",
  icon: "🛒",
  description: "Street vendor registration and zone allocation.",
  listPath: "/api/v1/vendor/registrations",
  resourceLabel: "Registrations",
  titleFields: ["vendorName"],
  numberFields: ["registrationNumber"],
  citizenServiceKey: "street-vendor",
  sec5: true,
};
