import { redirect } from "next/navigation";

/**
 * /finance/travel called finance-service routes that 404 (there is no
 * `/api/v1/finance/travel-claims` GET on this page's old shape) and is
 * superseded by the working hrms equivalent. Redirecting rather than
 * deleting keeps any bookmarked/old links landing somewhere real.
 */
export default function FinanceTravelRedirect() {
  redirect("/hr/travel");
}
