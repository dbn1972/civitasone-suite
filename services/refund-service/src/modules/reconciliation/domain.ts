export const DISBURSEMENT_STATUSES = ["initiated", "processing", "completed", "failed"] as const;
export type DisbursementStatus = (typeof DISBURSEMENT_STATUSES)[number];

export function canComplete(status: string): boolean {
  return status === "initiated" || status === "processing";
}

export function canFail(status: string): boolean {
  return status === "initiated" || status === "processing";
}

export function canReconcile(status: string): boolean {
  return status === "completed";
}
