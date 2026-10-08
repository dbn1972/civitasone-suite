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
  // GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-02: trade-service exposes the
  // per-service officer workflow + timeline endpoints, so wire the actions and
  // History card. decide requires under_scrutiny (approvals/domain.canDecide);
  // inspection can be initiated from submitted/under_scrutiny.
  workflow: {
    historyBasePath: "/api/v1/trade/applications",
    decisionPath: "/api/v1/trade/approvals/decide",
    scrutinyPath: "/api/v1/trade/approvals/scrutiny",
    officerRoles: ["trade_admin", "trade_officer", "super_admin"],
    decidableStatuses: ["under_scrutiny", "inspecting"],
    inspectableStatuses: ["submitted", "under_scrutiny"],
  },
};
