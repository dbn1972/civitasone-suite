import type { MunicipalServiceConfig } from "./types";

export const refundService: MunicipalServiceConfig = {
  serviceKey: "refund",
  moduleKey: "refund",
  label: "Fee Refund",
  shortLabel: "Refund",
  icon: "💸",
  description: "Citizen fee refund requests and disbursement tracking.",
  listPath: "/api/v1/refund/requests",
  resourceLabel: "Refund requests",
  titleFields: ["applicantName", "originalServiceType"],
  numberFields: ["requestNumber"],
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: refund/requests/domain.ts REQUEST_STATUSES.
  statusVocabulary: ["requested", "under_review", "approved", "rejected", "processing", "refunded", "failed", "withdrawn"],
  // GAP2-MUNICIPAL-DETAIL-MONEY-01: refund money columns are bigint paise
  // (the *_minor heuristic also catches them; listed for explicitness).
  moneyFields: ["originalAmountMinor", "refundAmountMinor"],
  // citizenServiceKey intentionally omitted — no citizen-service manifest exists yet.
  sec5: true,
};
