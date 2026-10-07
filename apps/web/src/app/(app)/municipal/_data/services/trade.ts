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
  // GAP-...-DETAIL-01: contact/identity fields to mask; GAP-...-DETAIL-03: lead
  // with the fields officers scan first. Key-name heuristics also catch
  // mobile/email/pan automatically; ownerMobile/ownerEmail are listed so the
  // intent is explicit per service owner.
  piiFields: ["ownerMobile", "ownerEmail", "ownerPan"],
  hiddenFields: [],
  fieldOrder: ["status", "applicationNumber", "businessName", "ownerName"],
  sec5: true,
};
