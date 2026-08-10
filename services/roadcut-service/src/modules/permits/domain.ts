export const PERMIT_STATUSES = ["issued", "active", "extended", "completed", "cancelled"] as const;
export type PermitStatus = (typeof PERMIT_STATUSES)[number];

export function canExtend(status: string): boolean {
  return status === "issued" || status === "active" || status === "extended";
}

export function canComplete(status: string): boolean {
  return status === "issued" || status === "active" || status === "extended";
}

export function canCancel(status: string): boolean {
  return status === "issued" || status === "active";
}

export function generatePermitNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `RCP/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function generateVerificationCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}
