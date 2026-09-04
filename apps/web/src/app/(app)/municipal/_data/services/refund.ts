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
  // citizenServiceKey intentionally omitted — no citizen-service manifest exists yet.
  sec5: true,
};
