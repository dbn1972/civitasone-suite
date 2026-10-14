import type { MunicipalServiceConfig } from "./types";

export const marketService: MunicipalServiceConfig = {
  serviceKey: "market",
  moduleKey: "market",
  label: "Market Allotment",
  shortLabel: "Market",
  icon: "🏪",
  description: "Market stall allotments, rent demands and lifecycle.",
  listPath: "/api/v1/market/allotments",
  resourceLabel: "Allotments",
  titleFields: ["allotteeName", "allotmentType"],
  numberFields: ["allotmentNumber"],
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: market/allotments/domain.ts AllotmentStatus.
  statusVocabulary: ["applied", "selected", "agreement_signed", "active", "transferred", "cancelled", "evicted"],
  citizenServiceKey: "market-stall",
  // W2 PQ-C: service-specific record fields the officer detail panel may show (allow-list, from the
  // market-service drizzle schema). Blobs (documents/photos), actor UUIDs and raw document numbers stay out.
  displayFields: ["allotmentNumber", "propertyId", "allotteeName", "allotmentType", "allotmentDate", "agreementStartDate", "agreementEndDate"],
  sec5: true,
};
