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
  // citizenServiceKey intentionally omitted — no citizen-service manifest exists yet.
  sec5: true,
};
