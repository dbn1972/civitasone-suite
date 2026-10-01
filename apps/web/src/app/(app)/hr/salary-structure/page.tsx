import { redirect } from "next/navigation";

/**
 * GAP-HR-SALARY-STRUCTURE-02: this page duplicated /hr/payroll/structures
 * against the exact same backend endpoint (GET /api/v1/payroll/structures)
 * while actually showing LESS real data than it appeared to -- its Grade/
 * Level, Components, Basic Pay Range, Effective Date and Employees-Covered
 * columns all read optional ApiStructure fields (grade/components/
 * basicPayRange/effectiveDate/employeeCount) that payroll-service's
 * listStructures() has never returned (it only ever sends
 * `{ id, name, isDefault, status }` -- see
 * services/payroll-service/src/modules/payroll/queries.ts), so those
 * columns have always rendered as "—" in production. /hr/payroll/structures
 * shows strictly more real information instead (per-structure component
 * composition, inferred pay bands, a full component catalog with taxability
 * and formulas) and is also where structure creation lives.
 *
 * This route is kept alive (not deleted) so old bookmarks/links still land
 * somewhere real, instead of 404ing.
 *
 * [HUMAN REVIEW]: this page-collapse decision (and the GAP-HR-SALARY-
 * STRUCTURE-05 role-gate fix on the redirect target) should get a second
 * look before merge -- see the PR description for the full comparison and
 * why no role-based or workflow reason was found for the two pages to stay
 * separate.
 */
export default function SalaryStructurePage() {
  redirect("/hr/payroll/structures");
}
