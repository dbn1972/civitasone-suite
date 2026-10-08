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
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: building/applications/domain.ts.
  statusVocabulary: ["draft", "submitted", "under_scrutiny", "approved", "rejected", "withdrawn"],
  // citizenServiceKey intentionally omitted — no citizen-service manifest exists yet.
  sec5: true,
};
