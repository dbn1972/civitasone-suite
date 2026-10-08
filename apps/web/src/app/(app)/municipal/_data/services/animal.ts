import type { MunicipalServiceConfig } from "./types";

export const animalService: MunicipalServiceConfig = {
  serviceKey: "animal",
  moduleKey: "animal",
  label: "Animal Control",
  shortLabel: "Animal",
  icon: "🐕",
  description: "Stray and nuisance animal complaints and operations.",
  listPath: "/api/v1/animal/complaints",
  resourceLabel: "Complaints",
  titleFields: ["animalType", "complaintType"],
  numberFields: ["complaintNumber"],
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: animal complaints use their own
  // status enum (services/animal-service/.../complaints/domain.ts
  // COMPLAINT_STATUSES) — none of the generic submitted/under_review/approved/
  // rejected/issued values can ever match, so drive the filter tabs from this.
  statusVocabulary: ["reported", "assigned", "dispatched", "action_taken", "closed"],
  // citizenServiceKey intentionally omitted — no citizen-service manifest exists yet.
  sec5: true,
};
