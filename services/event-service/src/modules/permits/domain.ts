export const PERMIT_STATUSES = ["issued", "active", "completed", "revoked"] as const;
export type PermitStatus = (typeof PERMIT_STATUSES)[number];

export function canRevoke(status: string): boolean {
  return status === "issued" || status === "active";
}

export function generatePermitNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `EVTP/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function generateVerificationCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}
