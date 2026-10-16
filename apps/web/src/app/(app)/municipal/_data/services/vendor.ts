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
  // W2 PQ-C: service-specific record fields the officer detail panel may show (allow-list, from the
  // vendor-service drizzle schema). Blobs (documents/photos), actor UUIDs and raw document numbers stay out.
  displayFields: ["vendorName", "preferredZone", "allocatedZone", "allocatedSpot", "feePaid"],
  // GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-03: status leads, then
  // the service's natural reference + subject fields, rest alphabetical.
  fieldOrder: ["status", "registrationNumber", "vendorName"],
  sec5: true,
};
