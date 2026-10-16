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
  // W2 PQ-C: service-specific record fields the officer detail panel may show (allow-list, from the
  // building-service drizzle schema). Blobs (documents/photos), actor UUIDs and raw document numbers stay out.
  displayFields: ["plotArea", "builtUpArea", "proposedFloors", "fsiRequested", "farComputed", "architectName", "architectLicenceNo", "structuralEngineer", "feePaid", "feeTransactionId"],
  // GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-03: status leads, then
  // the service's natural reference + subject fields, rest alphabetical.
  fieldOrder: ["status", "applicationNumber", "architectName", "siteAddress"],
  sec5: true,
};
