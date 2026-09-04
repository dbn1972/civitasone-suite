import type { MunicipalServiceConfig } from "./types";

export const tradeService: MunicipalServiceConfig = {
  serviceKey: "trade",
  moduleKey: "trade",
  label: "Trade Licence",
  shortLabel: "Trade",
  icon: "📋",
  description: "Trade licence applications, scrutiny and issuance.",
  listPath: "/api/v1/trade/applications",
  resourceLabel: "Applications",
  titleFields: ["businessName", "ownerName"],
  numberFields: ["applicationNumber"],
  citizenServiceKey: "trade-license",
  sec5: true,
};
