import type { PillVariant } from "@/app/_components/ds/StatusPill";

/**
 * GAP-FINANCE-TREASURY-E-PAYMENTS-05: explicit tone for the one payment status
 * the global StatusPill map must not decide. "Released" on a payment order means
 * the money went out (green), whereas the shared map reserves the word for
 * guarantee registers where it means "returned" (neutral). Pending Approval
 * (amber), Queued and Failed (red) come from the shared map / default.
 */
export function epaymentStatusVariant(status: string | null | undefined): PillVariant | undefined {
  const key = (status ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (key === "released" || key === "completed") return "good";
  if (key === "queued") return "mut";
  return undefined;
}
