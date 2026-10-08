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
  sec5: true,
};
