import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const rolesMock = vi.fn((): string[] => ["payroll_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  PAYROLL_REPORT_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"],
}));

import ArrearsPage from "./page";

// GAP-PAYROLL-ARREARS-01: the page now also resolves employee names through
// the hrms directory (fetchJson, ids= batch). Route each mocked call by path.
const E1 = "11111111-1111-4111-8111-111111111101";
const E2 = "11111111-1111-4111-8111-111111111102";
const E3 = "11111111-1111-4111-8111-111111111103";
function withDirectory(arrears: { data: unknown; source: string }, names: Array<[string, { name: string; employeeNo: string | null }]> = []) {
  fetchJsonMock.mockImplementation((path: string) =>
    Promise.resolve(path.startsWith("/api/v1/hrms/employees") ? { data: names, source: "api" } : arrears),
  );
}

// Fixtures use the REAL wire shape returned by GET /v1/payroll/arrears --
// i.e. the literal `payroll.payroll_arrears` columns (`SELECT *`), confirmed
// against services/payroll-service/src/modules/payroll/repo.ts (listArrears)
// and migrations/0035_world_class_payroll.sql. Before the fix, the page read
// `employee`/`department`/`arrearType`/`period`/`amount`/`payableMonth` --
// none of which the API has ever sent -- so every real row rendered blank.
describe("ArrearsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("maps real backend-shaped rows onto the table instead of rendering blanks", async () => {
    withDirectory({
      data: [
        {
          id: "a1",
          employee_id: E1,
          run_id: null,
          component_code: "DA_ARREAR",
          from_period: "2025-04",
          to_period: "2025-07",
          old_amount_minor: 4500000,
          new_amount_minor: 5000000,
          difference_minor: 500000,
          reason: "DA revision Jan 2025",
          status: "pending",
          source: "revision",
          created_at: "2025-08-01T00:00:00Z",
        },
        {
          id: "a2",
          employee_id: E2,
          run_id: "r-9",
          component_code: "PROMOTION_ARREAR",
          from_period: "2025-01",
          to_period: "2025-03",
          old_amount_minor: 6000000,
          new_amount_minor: 6800000,
          difference_minor: 800000,
          reason: "Promotion w.e.f. Jan 2025",
          status: "paid",
          source: "manual",
          created_at: "2025-05-01T00:00:00Z",
        },
        {
          id: "a3",
          employee_id: E3,
          run_id: "r-9",
          component_code: "PAY_FIXATION_ARREAR",
          from_period: "2024-07",
          to_period: "2024-12",
          old_amount_minor: 5200000,
          new_amount_minor: 5900000,
          difference_minor: 700000,
          reason: "7th CPC fixation",
          status: "paid",
          source: "manual",
          created_at: "2025-05-01T00:00:00Z",
        },
      ],
      source: "api",
    }, [
      [E1, { name: "Asha Rao", employeeNo: "EMP-101" }],
      [E2, { name: "Vikram Singh", employeeNo: null }],
    ]);

    const ui = await ArrearsPage();
    render(ui);

    // GAP-PAYROLL-ARREARS-01: names (with employee code), never the raw UUID;
    // an id the directory didn't return renders "Unknown employee" + short id.
    expect(screen.getByText("Asha Rao (EMP-101)")).toBeInTheDocument();
    expect(screen.getByText("Vikram Singh")).toBeInTheDocument();
    expect(screen.getByText(`Unknown employee · ${E3.slice(0, 8)}`)).toBeInTheDocument();
    expect(screen.queryByText(E1)).not.toBeInTheDocument();
    // One batched directory lookup for all three ids, not one per row.
    const dirCalls = fetchJsonMock.mock.calls.filter(([p]) => String(p).startsWith("/api/v1/hrms/employees"));
    expect(dirCalls).toHaveLength(1);
    expect(String(dirCalls[0][0])).toContain(`ids=${E1},${E2},${E3}`);

    // Arrear Type (was `.arrearType`; real field is `component_code`); an
    // unrecognised code is shown as-is.
    expect(screen.getByText("DA_ARREAR")).toBeInTheDocument();

    // GAP-PAYROLL-ARREARS-06: periods read "Apr 2025", not "2025-04".
    expect(screen.getByText("Apr 2025")).toBeInTheDocument();
    expect(screen.getByText("Jul 2025")).toBeInTheDocument();
    expect(screen.queryByText("2025-04")).not.toBeInTheDocument();

    // Reason (a real field the old page didn't surface at all).
    expect(screen.getByText("DA revision Jan 2025")).toBeInTheDocument();

    // Amount (was `.amount` with no cellType; real field is `difference_minor`,
    // rendered minor-unit-safe via the table's `cellType: "amount"` -> formatMoney).
    expect(screen.getAllByText("₹5,000.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("₹8,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹7,000.00")).toBeInTheDocument();

    // Stat cards: Total / Pending / Approved-or-Paid / money total. Also guards
    // the pre-existing "Processed" stat bug, which compared status to the
    // non-existent value "processed" -- the real CHECK constraint only allows
    // pending/approved/paid/rejected, so that counter always undercounted.
    expect(screen.getByText("3")).toBeInTheDocument(); // Total
    expect(screen.getByText("1")).toBeInTheDocument(); // Pending (a1 only)
    expect(screen.getByText("2")).toBeInTheDocument(); // Approved/Paid (a2 + a3)
    // GAP-PAYROLL-ARREARS-02: the money stat is OUTSTANDING (pending+approved) only --
    // the two paid rows (8,000 + 7,000) must not be netted into it any more.
    expect(screen.getByText("Outstanding Arrears (net of recoveries)")).toBeInTheDocument();
    expect(screen.queryByText("₹20,000.00")).not.toBeInTheDocument();
  });

  it("renders an empty state when there are no arrears", async () => {
    withDirectory({ data: [], source: "api" });

    const ui = await ArrearsPage();
    render(ui);

    expect(screen.getByText("No arrears computed")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    withDirectory({ data: [], source: "error" });

    const ui = await ArrearsPage();
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-ARREARS-05: back link returns to the payroll hub", async () => {
    withDirectory({ data: [], source: "api" });
    const ui = await ArrearsPage();
    render(ui);
    const back = screen.getByRole("link", { name: /Back to Payroll/ });
    expect(back).toHaveAttribute("href", "/hr/payroll");
  });

  it("GAP-PAYROLL-ARREARS-02: outstanding total excludes rejected and paid rows and nets recoveries", async () => {
    const base = { run_id: null, component_code: "BASIC", from_period: "2026-01", to_period: "2026-02", old_amount_minor: 0, new_amount_minor: 0, reason: null, source: "manual", created_at: "2026-03-01T00:00:00Z" };
    withDirectory({
      data: [
        { ...base, id: "x1", employee_id: E1, difference_minor: 100000, status: "approved" },
        { ...base, id: "x2", employee_id: E2, difference_minor: 50000, status: "rejected" },
        { ...base, id: "x3", employee_id: E3, difference_minor: -20000, status: "pending" },
        { ...base, id: "x4", employee_id: E3, difference_minor: 999900, status: "paid" },
      ],
      source: "api",
    });
    render(await ArrearsPage());
    // 1,000.00 + (-200.00) = 800.00; rejected 500 and paid 9,999 stay out.
    expect(screen.getByText("₹800.00")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-ARREARS-04: employee/manager see a permission denial and no register fetch", async () => {
    for (const role of ["employee", "manager"]) {
      fetchJsonMock.mockReset();
      rolesMock.mockReturnValue([role]);
      const { unmount } = render(await ArrearsPage());
      expect(screen.queryByText("Arrears Register")).not.toBeInTheDocument();
      expect(fetchJsonMock).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("GAP-PAYROLL-ARREARS-04: hr_admin still sees the register", async () => {
    rolesMock.mockReturnValue(["hr_admin"]);
    withDirectory({ data: [], source: "api" });
    render(await ArrearsPage());
    expect(screen.getByText("No arrears computed")).toBeInTheDocument();
  });
});
