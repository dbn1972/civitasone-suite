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
  citizenServiceKey: "market-stall",
  sec5: true,
};
