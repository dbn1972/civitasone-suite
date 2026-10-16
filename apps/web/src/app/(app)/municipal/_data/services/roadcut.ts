import type { MunicipalServiceConfig } from "./types";

export const roadcutService: MunicipalServiceConfig = {
  serviceKey: "roadcut",
  moduleKey: "roadcut",
  label: "Road Cutting",
  shortLabel: "Road cut",
  icon: "🚧",
  description: "Road cutting and restoration permit applications.",
  listPath: "/api/v1/roadcut/applications",
  resourceLabel: "Applications",
  titleIsPerson: true,
  titleFields: ["applicantName", "purpose"],
  numberFields: ["applicationNumber"],
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: roadcut/applications/domain.ts.
  statusVocabulary: ["draft", "submitted", "under_review", "approved", "rejected", "withdrawn"],
  citizenServiceKey: "road-cutting",
  // W2 PQ-C: service-specific record fields the officer detail panel may show (allow-list, from the
  // roadcut-service drizzle schema). Blobs (documents/photos), actor UUIDs and raw document numbers stay out.
  displayFields: ["applicantName", "applicantOrg", "roadType", "cuttingLength", "cuttingWidth", "cuttingDepth"],
  // GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-03: status leads, then
  // the service's natural reference + subject fields, rest alphabetical.
  fieldOrder: ["status", "applicationNumber", "applicantName", "purpose"],
  sec5: true,
};
