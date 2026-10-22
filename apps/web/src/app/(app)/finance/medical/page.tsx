import { redirect } from "next/navigation";

/**
 * /finance/medical called finance-service routes that 404 (there is no
 * `/api/v1/finance/medical-claims` GET on this page's old shape) and is
 * superseded by the working hrms equivalent. Redirecting rather than
 * deleting keeps any bookmarked/old links landing somewhere real.
 *
 * GAP-FINANCE-MEDICAL-02: the effective redirect now lives in next.config.mjs,
 * because finance/layout.tsx role-gates every /finance/* child before this page
 * runs (an employee / manager / HR user would see PermissionDenied). This
 * page-level redirect is kept only as a fallback if that config rule is ever
 * removed.
 */
export default function FinanceMedicalRedirect() {
  redirect("/hr/medical");
}
