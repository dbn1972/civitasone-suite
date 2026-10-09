import type { MunicipalServiceConfig } from "./types";

export const swmService: MunicipalServiceConfig = {
  serviceKey: "swm",
  moduleKey: "swm",
  label: "Solid Waste Management",
  shortLabel: "SWM",
  icon: "♻️",
  description: "Bulk waste generator registration and hotspot tracking.",
  listPath: "/api/v1/swm/bulk-generators",
  resourceLabel: "Bulk generators",
  titleFields: ["generatorName"],
  numberFields: ["registrationNumber"],
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: swm/bulk_generators/domain.ts GeneratorStatus.
  statusVocabulary: ["registered", "active", "suspended", "cancelled"],
  // GAP2-MUNICIPAL-DETAIL-MONEY-01: feeMinor is bigint paise (the *_minor
  // heuristic also catches it; listed for explicitness).
  moneyFields: ["feeMinor"],
  // citizenServiceKey intentionally omitted — no citizen-service manifest exists yet.
  sec5: true,
};
