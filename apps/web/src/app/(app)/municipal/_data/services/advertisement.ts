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
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: advertisement/applications/domain.ts.
  statusVocabulary: ["draft", "submitted", "under_review", "approved", "rejected", "withdrawn"],
  citizenServiceKey: "advertisement-hoarding",
  // W2 PQ-C: service-specific record fields the officer detail panel may show (allow-list, from the
  // advertisement-service drizzle schema). Blobs (documents/photos), actor UUIDs and raw document numbers stay out.
  displayFields: ["advertiserName", "advertiserOrg", "advertisementType", "dimensions", "structuralDetails", "feePaid"],
  // GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-03: status leads, then
  // the service's natural reference + subject fields, rest alphabetical.
  fieldOrder: ["status", "applicationNumber", "advertiserName", "advertiserOrg"],
  sec5: true,
};
