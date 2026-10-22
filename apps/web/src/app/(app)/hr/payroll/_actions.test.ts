import { describe, it, expect, vi, beforeEach } from "vitest";

// GAP-PAYROLL-HOME-06: revalidatePayrollRunLists() is the Server Action the create form
// awaits before navigating, so the client drops its cached run-list pages. Only a
// payroll administrator can trigger it; for anyone else it is a silent no-op.
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const sessionRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => sessionRoles() };
});

import { revalidatePayrollRunLists } from "./_actions";

beforeEach(() => {
  revalidatePath.mockReset();
  sessionRoles.mockReset();
});

describe("revalidatePayrollRunLists", () => {
  it.each(["payroll_admin", "payroll_officer", "super_admin"])("%s: revalidates the home, runs and period lists", async (role) => {
    sessionRoles.mockReturnValue([role]);
    await revalidatePayrollRunLists();
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual(["/hr/payroll", "/hr/payroll/runs", "/hr/payroll/period"]);
  });

  it.each([[[]], [["employee"]], [["manager"]], [["hr_admin"]], [["finance_officer"]]])(
    "%j: no payroll-admin role, so nothing is revalidated",
    async (roles) => {
      sessionRoles.mockReturnValue(roles);
      await revalidatePayrollRunLists();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});
