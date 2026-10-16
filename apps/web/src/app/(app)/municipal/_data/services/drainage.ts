import type { MunicipalServiceConfig } from "./types";

export const drainageService: MunicipalServiceConfig = {
  serviceKey: "drainage",
  moduleKey: "drainage",
  label: "Drainage",
  shortLabel: "Drainage",
  icon: "🌊",
  description: "Drainage complaints, hotspots and field resolution.",
  listPath: "/api/v1/drainage/complaints",
  resourceLabel: "Complaints",
  titleFields: ["complaintType", "location"],
  numberFields: ["complaintNumber"],
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: drainage/complaints/domain.ts ComplaintStatus.
  statusVocabulary: ["reported", "assigned", "in_progress", "resolved", "closed"],
  // citizenServiceKey intentionally omitted — no citizen-service manifest exists yet.
  // W2 PQ-C: service-specific record fields the officer detail panel may show (allow-list, from the
  // drainage-service drizzle schema). Blobs (documents/photos), actor UUIDs and raw document numbers stay out.
  displayFields: ["severity", "resolution", "resolvedAt"],
  // GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-03: status leads, then
  // the service's natural reference + subject fields, rest alphabetical.
  fieldOrder: ["status", "complaintNumber", "complaintType", "location"],
  sec5: true,
};
