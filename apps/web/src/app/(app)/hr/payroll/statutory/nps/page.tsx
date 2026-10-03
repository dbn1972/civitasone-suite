import { redirect } from "next/navigation";

/**
 * GAP-PAYROLL-STATUTORY-NPS-01 / GAP-PAYROLL-STATUTORY-02: this route was an
 * orphaned twin of /hr/payroll/nps -- both read GET /v1/payroll/statutory/nps,
 * the statutory hub links only to /hr/payroll/nps, and that page is the
 * richer one (employee name, chart, projection). Same resolution as the GPF
 * twin (GAP-PAYROLL-STATUTORY-GPF-01): the duplicate is removed and this stub
 * keeps bookmarked URLs working by sending them to the canonical page.
 */
export default function LegacyStatutoryNpsRedirect(): never {
  redirect("/hr/payroll/nps");
}
