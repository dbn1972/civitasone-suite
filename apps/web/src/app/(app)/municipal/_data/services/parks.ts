import type { MunicipalServiceConfig } from "./types";

export const parksService: MunicipalServiceConfig = {
  serviceKey: "parks",
  moduleKey: "parks",
  label: "Parks & Trees",
  shortLabel: "Parks",
  icon: "🌳",
  description: "Tree cutting/trimming requests and park asset upkeep.",
  listPath: "/api/v1/parks/tree-requests",
  resourceLabel: "Tree requests",
  titleFields: ["requestType", "treeSpecies"],
  numberFields: ["requestNumber"],
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: parks/tree_requests/domain.ts TreeRequestStatus.
  statusVocabulary: ["submitted", "inspected", "approved", "rejected", "work_ordered", "completed"],
  // citizenServiceKey intentionally omitted — no citizen-service manifest exists yet.
  sec5: true,
};
