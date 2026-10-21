import { HR_STAFF_ROLES } from "@/lib/auth/workRoles";
// GAP-HR-CONTRACTUAL-05: pure rules mirrored from hrms-service/contracts
// (domain.ts CONTRACT_TRANSITIONS, routes.ts HR_ROLES/ALL_ROLES and the
// renew status guard). The backend stays the enforcement point; these only
// decide which controls to offer.
export const CONTRACT_HR_ROLES = HR_STAFF_ROLES;
export const CONTRACT_RENEW_ROLES = [...CONTRACT_HR_ROLES, "manager"];

export function canRenew(status: string, roles: string[]): boolean {
  return (status === "active" || status === "expiring") && roles.some((r) => CONTRACT_RENEW_ROLES.includes(r));
}

// domain.ts: only `active` -> `terminated` is a valid transition.
export function canTerminate(status: string, roles: string[]): boolean {
  return status === "active" && roles.some((r) => CONTRACT_HR_ROLES.includes(r));
}

/** A contract still in force that ends within this many days counts as "expiring" (mirrors hrms-service CONTRACT_EXPIRING_WINDOW_DAYS). */
export const EXPIRING_WINDOW_DAYS = 30;

export type ContractExpiryState = "expired" | "expiring" | "active" | "none";

/**
 * GAP-HR-CONTRACTUAL-04: where a contract stands against today, from its status AND its end date
 * (`daysToExpiry` = whole IST calendar days from today to the end date; negative once past it; null when the
 * date is missing/unparseable). The same classes hrms-service uses for the register's counts
 * (contracts/repo.ts summarizeContracts), so a row's badge and the stat cards can never disagree:
 *   none      terminated / renewed / draft, or an unreadable end date on an open contract -- not in force
 *   expired   status 'expired', or still open (active/expiring/escalated) and past its end date
 *   expiring  in force and ending within EXPIRING_WINDOW_DAYS (or flagged 'expiring' by the scheduler)
 *   active    in force, further out
 */
export function contractExpiryState(status: string, daysToExpiry: number | null): ContractExpiryState {
  if (status === "terminated" || status === "renewed" || status === "draft") return "none";
  if (status === "expired") return "expired";
  if (daysToExpiry === null) return "none";
  if (daysToExpiry < 0) return "expired";
  if (status === "expiring" || daysToExpiry <= EXPIRING_WINDOW_DAYS) return "expiring";
  return "active";
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
