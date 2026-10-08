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
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: vendor/registrations/domain.ts REGISTRATION_STATUSES.
  statusVocabulary: ["draft", "submitted", "under_review", "zone_allocated", "approved", "rejected", "withdrawn"],
  citizenServiceKey: "street-vendor",
  sec5: true,
};
