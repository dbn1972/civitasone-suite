export const APPLICATION_STATUSES = ["draft", "submitted", "under_review", "approved", "rejected", "withdrawn"] as const;
export type ApplicationStatus = typeof APPLICATION_STATUSES[number];

export function assertTransition(from: string, to: ApplicationStatus): void {
  const allowed: Record<string, ApplicationStatus[]> = {
    draft:        ["submitted", "withdrawn"],
    submitted:    ["under_review", "withdrawn"],
    under_review: ["approved", "rejected"],
    approved:     [],
    rejected:     [],
    withdrawn:    [],
  };
  if (!allowed[from]?.includes(to)) {
    throw new Error(`INVALID_TRANSITION: cannot move from '${from}' to '${to}'`);
  }
}
