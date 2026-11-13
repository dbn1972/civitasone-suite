/**
 * UAT Phase 2 C3 (J13): shared vocabulary for the inspection-report screens.
 * Role sets mirror services/inspection-service/src/modules/reports/routes.ts
 * (the service is the authority; these only decide which actions to offer).
 */
export const REPORT_INSPECTOR_ROLES = ["inspector", "reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];
export const REPORT_REVIEWER_ROLES = ["reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];

export const REPORT_TYPES = ["standard", "surprise", "follow_up", "joint"] as const;
export const REPORT_GRADES = ["A", "B", "C", "D", "F"] as const;
export const OBSERVATION_SEVERITIES = ["critical", "major", "minor", "observation"] as const;

/** Message key (inspectionReports.*) for a report status. */
export const REPORT_STATUS_KEYS: Record<string, string> = {
  draft: "statusDraft",
  submitted: "statusSubmitted",
  approved: "statusApproved",
  rejected: "statusRejected",
};
export const REPORT_TYPE_KEYS: Record<string, string> = {
  standard: "typeStandard",
  surprise: "typeSurprise",
  follow_up: "typeFollowUp",
  joint: "typeJoint",
};
export const SEVERITY_KEYS: Record<string, string> = {
  critical: "severityCritical",
  major: "severityMajor",
  minor: "severityMinor",
  observation: "severityObservation",
};

/** Statuses a report may still receive observations in (reports/domain.ts OBSERVABLE_STATUSES). */
export const OBSERVABLE_STATUSES = new Set(["draft", "submitted", "rejected"]);

/** Statuses the inspector may (re)submit from (reports/domain.ts SUBMITTABLE_STATUSES). */
export const SUBMITTABLE_STATUSES = new Set(["draft", "rejected"]);

/**
 * The officers who may NOT approve a report (reports/domain.ts reportMakers):
 * its inspector, its creator and whoever submitted it.
 */
export function reportMakers(r: { inspectorId?: string | undefined; createdBy?: string | undefined; submittedBy?: string | null | undefined; updatedBy?: string | undefined }): string[] {
  return [r.inspectorId, r.createdBy, r.submittedBy ?? r.updatedBy].filter((x): x is string => typeof x === "string" && x.length > 0);
}
