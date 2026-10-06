import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildApprovalLink } from "@/app/_data/loaders";

/**
 * GAP-APPROVALS-HOME-02: the inbox used to emit /finance/bills/<id> and
 * /workflow/tasks, neither of which exists under app/(app), so those rows
 * 404'd. buildApprovalLink is now a pure function with a closed route table;
 * this test pins each mapping AND asserts the (static part of the) returned
 * path corresponds to a real Next.js route segment on disk, so a future rename
 * can't silently reintroduce a dead inbox link.
 */
// This test file lives at app/(app)/approvals/_components; the (app) route
// root is two levels up.
const ROUTES_ROOT = join(__dirname, "..", "..");

/** Does a (possibly parameterised) app path resolve to a page.tsx on disk? */
function routeExists(path: string): boolean {
  const segments = path.replace(/^\//, "").split("/");
  // Try the path as literal folders, and with the final segment as a [id] dir.
  const candidates: string[][] = [segments, [...segments.slice(0, -1), "[id]"]];
  return candidates.some((segs) => existsSync(join(ROUTES_ROOT, ...segs, "page.tsx")));
}

describe("buildApprovalLink (GAP-APPROVALS-HOME-02)", () => {
  it("maps a finance bill to the real expenditure bills detail route", () => {
    expect(buildApprovalLink("finance", "finance_bill", "x", "i1")).toBe("/finance/expenditure/bills/x");
  });

  it("maps each known refType to a confirmed route", () => {
    const cases: Array<[string, string, string]> = [
      ["leave_app", "r1", "/hr/leave/approvals"],
      ["payroll_run", "r1", "/hr/payroll"],
      ["procurement_indent", "r1", "/procurement/indents/r1"],
      ["procurement_po", "r1", "/procurement/orders/r1"],
      ["finance_bill", "r1", "/finance/expenditure/bills/r1"],
      ["estab_file", "r1", "/estab/files/r1"],
    ];
    for (const [refType, refId, expected] of cases) {
      expect(buildApprovalLink("m", refType, refId, "inst-1")).toBe(expected);
    }
  });

  it("an unmapped refType never emits a dead route: instance when known, else the tasks inbox", () => {
    expect(buildApprovalLink("works", "works_bill", "r1", "inst-9")).toBe("/workflow/instances/inst-9");
    expect(buildApprovalLink("crm", "crm_case", "r1", "")).toBe("/workflow/my-tasks");
  });

  it("every path buildApprovalLink can return corresponds to a real app route", () => {
    const refTypes = [
      "leave_app",
      "payroll_run",
      "procurement_indent",
      "procurement_po",
      "finance_bill",
      "estab_file",
      "some_unknown_type",
    ];
    for (const refType of refTypes) {
      const withInstance = buildApprovalLink("m", refType, "the-ref-id", "the-instance-id");
      expect(routeExists(withInstance), `${refType} -> ${withInstance}`).toBe(true);
    }
    // The no-instance fallback as well.
    expect(routeExists(buildApprovalLink("m", "unknown", "r", ""))).toBe(true);
  });
});
