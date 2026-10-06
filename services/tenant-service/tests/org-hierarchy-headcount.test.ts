/**
 * GAP-TENANT-ADMIN-ORG-HIERARCHY-05: the question was whether an org unit's
 * `headCount` is a direct count or a rolled-up (descendant-inclusive) total.
 * REFUTED at the source: the tenant.org_units table has NO head-count / staff
 * / employee column at all, and GET /v1/org/hierarchy returns the raw unit
 * rows, so the web's optional `headCount` is never populated by the backend
 * (the UI correctly shows "—" for Total Staff). This pins that the schema
 * carries no such column, so a future addition is a deliberate decision.
 */
import { describe, it, expect } from "vitest";
import { orgUnits } from "../src/modules/org-hierarchy/schema.js";

describe("GAP-TENANT-ADMIN-ORG-HIERARCHY-05 — org_units has no head/staff count", () => {
  it("exposes only structural columns, no headCount/employeeCount/staff", () => {
    const columns = Object.keys(orgUnits);
    for (const forbidden of ["headCount", "head_count", "employeeCount", "employee_count", "staffCount", "staff_count"]) {
      expect(columns).not.toContain(forbidden);
    }
    // structural columns that DO exist
    expect(columns).toEqual(expect.arrayContaining(["name", "type", "parentId", "headUserId"]));
  });
});
