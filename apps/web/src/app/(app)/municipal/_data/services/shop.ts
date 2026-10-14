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
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: shop/registrations/domain.ts APPLICATION_STATUSES.
  statusVocabulary: ["draft", "submitted", "under_scrutiny", "inspecting", "approved", "rejected", "withdrawn"],
  citizenServiceKey: "shops-establishments",
  // W2 PQ-C: service-specific record fields the officer detail panel may show (allow-list, from the
  // shop-service drizzle schema). Blobs (documents/photos), actor UUIDs and raw document numbers stay out.
  displayFields: ["establishmentName", "establishmentType", "ownerType", "premisesAddress", "premisesPropertyId", "activityDescription", "activityCategory", "employeeCount", "capacityDetails", "feePaid", "feeTransactionId"],
  sec5: false,
};
