import { redirect } from "next/navigation";

/**
 * GAP-PAYROLL-STATUTORY-GPF-01: this route was an orphaned twin of
 * /hr/payroll/gpf -- both read GET /v1/payroll/statutory/gpf, the statutory hub
 * links only to /hr/payroll/gpf, and /hr/payroll/gpf is the richer page (names,
 * trend, role gate). The twin is removed; this stub keeps bookmarked URLs
 * working by sending them to the canonical page.
 */
export default function LegacyStatutoryGpfRedirect(): never {
  redirect("/hr/payroll/gpf");
}
