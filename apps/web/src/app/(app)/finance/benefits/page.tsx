import { redirect } from "next/navigation";

/**
 * /finance/benefits called finance-service routes that 404 (there is no
 * `/api/v1/finance/benefits` GET on this page's old shape) and is superseded
 * by the working hrms equivalent. Redirecting rather than deleting keeps any
 * bookmarked/old links landing somewhere real.
 */
export default function FinanceBenefitsRedirect() {
  redirect("/hr/benefits");
}
