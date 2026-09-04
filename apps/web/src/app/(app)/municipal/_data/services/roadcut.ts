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
  citizenServiceKey: "road-cutting",
  sec5: true,
};
