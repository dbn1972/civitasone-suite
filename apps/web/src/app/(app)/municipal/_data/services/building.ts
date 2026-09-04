import type { MunicipalServiceConfig } from "./types";

export const buildingService: MunicipalServiceConfig = {
  serviceKey: "building",
  moduleKey: "building",
  label: "Building Plan",
  shortLabel: "Building",
  icon: "🏗️",
  description: "Building plan scrutiny, permits and lifecycle.",
  listPath: "/api/v1/building/applications",
  resourceLabel: "Applications",
  titleFields: ["architectName", "siteAddress"],
  numberFields: ["applicationNumber"],
  // citizenServiceKey intentionally omitted — no citizen-service manifest exists yet.
  sec5: true,
};
