export const INSPECTION_STATUSES = ["scheduled", "completed", "failed"] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const RECOMMENDATIONS = ["approve", "reject", "re_inspect"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export function validateFindings(findings: unknown): boolean {
  if (!findings || typeof findings !== "object") return false;
  if (!Array.isArray(findings)) return false;
  return findings.every(
    (f) => typeof f === "object" && f !== null && typeof f.description === "string",
  );
}

export function canRecommend(status: InspectionStatus): boolean {
  return status === "completed";
}
