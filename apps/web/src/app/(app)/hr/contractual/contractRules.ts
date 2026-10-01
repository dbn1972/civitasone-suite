// GAP-HR-CONTRACTUAL-05: pure rules mirrored from hrms-service/contracts
// (domain.ts CONTRACT_TRANSITIONS, routes.ts HR_ROLES/ALL_ROLES and the
// renew status guard). The backend stays the enforcement point; these only
// decide which controls to offer.
export const CONTRACT_HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
export const CONTRACT_RENEW_ROLES = [...CONTRACT_HR_ROLES, "manager"];

export function canRenew(status: string, roles: string[]): boolean {
  return (status === "active" || status === "expiring") && roles.some((r) => CONTRACT_RENEW_ROLES.includes(r));
}

// domain.ts: only `active` -> `terminated` is a valid transition.
export function canTerminate(status: string, roles: string[]): boolean {
  return status === "active" && roles.some((r) => CONTRACT_HR_ROLES.includes(r));
}

export type HistoryRow = { id: string; contractNo: string; startDate: string; endDate: string; status: string };

/**
 * The history endpoint returns full contract rows including the `terms` JSONB
 * (compensationMinor etc.). The table shows none of that, so only the shown
 * columns are allowed to cross into the client DataTable / RSC payload.
 */
export function toHistoryRows(rows: ReadonlyArray<Record<string, unknown>>): HistoryRow[] {
  return rows.map((r) => ({
    id: String(r.id),
    contractNo: String(r.contractNo ?? ""),
    startDate: String(r.startDate ?? ""),
    endDate: String(r.endDate ?? ""),
    status: String(r.status ?? ""),
  }));
}

/** Returns an error key, or null when the new end date is acceptable (strictly after the current one). */
export function validateNewEndDate(newEndDate: string, currentEndDate: string): "required" | "invalid" | "notAfter" | null {
  if (!newEndDate) return "required";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newEndDate) || Number.isNaN(Date.parse(newEndDate))) return "invalid";
  return newEndDate > currentEndDate ? null : "notAfter";
}
