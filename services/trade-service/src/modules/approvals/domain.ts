export const SCRUTINY_TYPES = ["document_check", "field_inspection", "noc"] as const;
export type ScrutinyType = (typeof SCRUTINY_TYPES)[number];

export const SCRUTINY_STATUSES = ["pending", "completed", "deficiency_found"] as const;
export type ScrutinyStatus = (typeof SCRUTINY_STATUSES)[number];

export const DECISION_TYPES = ["approved", "rejected"] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export interface ScrutinyFinding {
  checkItem: string;
  result: "pass" | "fail" | "na";
  remarks?: string;
}

export function validateScrutinyComplete(findings: ScrutinyFinding[]): {
  allPassed: boolean;
  deficiencies: string[];
} {
  const deficiencies: string[] = [];
  for (const f of findings) {
    if (f.result === "fail") {
      deficiencies.push(f.remarks ?? f.checkItem);
    }
  }
  return { allPassed: deficiencies.length === 0, deficiencies };
}

export function canDecide(applicationStatus: string): boolean {
  return applicationStatus === "under_scrutiny" || applicationStatus === "inspecting";
}
