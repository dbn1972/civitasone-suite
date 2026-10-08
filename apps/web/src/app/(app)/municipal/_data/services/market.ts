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
  sec5: true,
};
