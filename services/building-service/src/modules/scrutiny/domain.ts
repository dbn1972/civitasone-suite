export const DISCIPLINES = ["structural", "fire", "environmental", "heritage", "general"] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const SCRUTINY_STATUSES = ["pending", "completed", "deficiency_found"] as const;
export type ScrutinyStatus = (typeof SCRUTINY_STATUSES)[number];

export const DECISION_TYPES = ["approved", "rejected"] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export interface DcrCheckItem {
  checkName: string;
  parameter: string;
  allowedValue: string;
  actualValue: string;
  result: "pass" | "fail" | "na";
  remarks?: string;
}

export function validateDcrResults(items: DcrCheckItem[]): {
  allPassed: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  for (const item of items) {
    if (item.result === "fail") {
      failures.push(`${item.checkName}: ${item.remarks ?? `expected ${item.allowedValue}, got ${item.actualValue}`}`);
    }
  }
  return { allPassed: failures.length === 0, failures };
}

export function canDecide(applicationStatus: string): boolean {
  return applicationStatus === "under_scrutiny";
}
