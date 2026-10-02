/**
 * Pure policy for the sanction detail page's approval controls
 * (GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-01 / -04). Kept out of the client panel
 * so the server page can import the role list.
 */
import type { LinkedFile } from "../../../../../_components/RaiseEOfficeNote";
import { isEofficeFileInFlight } from "../../../../../_components/eofficeFileStatus";

/**
 * A sanction an eOffice decision rejected is stored `cancelled` by
 * finance-service; map it to "rejected" (the same mapping the backend list
 * applies) so it never reads as "pending" and keeps the approval controls locked.
 */
export function normalizeSanctionStatus(status: string | null | undefined): string {
  const s = (status ?? "").trim().toLowerCase();
  return s === "cancelled" || s === "canceled" ? "rejected" : s;
}

/** Roles finance-service accepts on PATCH /v1/finance/sanctions/:id/approve. */
export const SANCTION_APPROVER_ROLES = ["finance_admin", "super_admin"];

export type SanctionApprovalMode = "pending-lookup" | "awaiting-eoffice" | "choose" | "eoffice-only" | "none";

/** Only an open / in-progress / pending file locks direct approval; a rejected or closed one does not. */

export function sanctionApprovalMode(args: {
  isPending: boolean;
  canApprove: boolean;
  loading: boolean;
  file: LinkedFile | null;
}): SanctionApprovalMode {
  if (!args.isPending) return "none";
  if (args.loading) return "pending-lookup";
  if (args.file && isEofficeFileInFlight(args.file.status)) return "awaiting-eoffice";
  return args.canApprove ? "choose" : "eoffice-only";
}
