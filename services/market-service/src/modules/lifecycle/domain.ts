export const REQUEST_TYPES = ["transfer", "cancellation", "eviction"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const REQUEST_STATUSES = ["submitted", "under_review", "approved", "rejected", "completed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const VALID_TRANSITIONS: Record<string, RequestStatus[]> = {
  submitted: ["under_review", "rejected"],
  under_review: ["approved", "rejected"],
  approved: ["completed"],
  rejected: [],
  completed: [],
};

export function canTransition(from: string, to: RequestStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export function generateRequestNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `MKT-LC/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}
