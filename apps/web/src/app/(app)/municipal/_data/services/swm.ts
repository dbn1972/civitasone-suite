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
  // citizenServiceKey intentionally omitted — no citizen-service manifest exists yet.
  sec5: true,
};
