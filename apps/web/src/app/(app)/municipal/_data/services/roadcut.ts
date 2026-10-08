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
  titleFields: ["applicantName", "purpose"],
  numberFields: ["applicationNumber"],
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: roadcut/applications/domain.ts.
  statusVocabulary: ["draft", "submitted", "under_review", "approved", "rejected", "withdrawn"],
  citizenServiceKey: "road-cutting",
  sec5: true,
};
