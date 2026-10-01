import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import SalaryStructurePage from "./page";

// GAP-HR-SALARY-STRUCTURE-02: this route is now a thin redirect to the
// richer /hr/payroll/structures page (same backend endpoint, strictly more
// real data -- see page.tsx's own comment for the full rationale). This
// test is the acceptance check for that collapse: the old route must still
// resolve, and must land exactly on the new one.
describe("SalaryStructurePage", () => {
  it("redirects to /hr/payroll/structures", () => {
    SalaryStructurePage();
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/hr/payroll/structures");
  });
});
