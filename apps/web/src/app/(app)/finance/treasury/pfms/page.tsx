import { redirect } from "next/navigation";

/**
 * GAP-FINANCE-PFMS-08: this read-only scroll list duplicated /finance/pfms
 * (same batches endpoint, fewer capabilities, and its subtitle claimed
 * beneficiary verification it never did). /finance/pfms is the single PFMS
 * route; the old URL stays alive as a redirect so bookmarks keep working.
 */
export default function TreasuryPfmsRedirect(): never {
  redirect("/finance/pfms");
}
