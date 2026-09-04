import type { MunicipalServiceConfig } from "./types";

export const advertisementService: MunicipalServiceConfig = {
  serviceKey: "advertisement",
  moduleKey: "advertisement",
  label: "Advertisement Licence",
  shortLabel: "Advertisement",
  icon: "📢",
  description: "Hoarding and advertisement permit applications.",
  listPath: "/api/v1/advertisement/applications",
  resourceLabel: "Applications",
  titleFields: ["advertiserName", "advertiserOrg"],
  numberFields: ["applicationNumber"],
  citizenServiceKey: "advertisement-hoarding",
  sec5: true,
};
