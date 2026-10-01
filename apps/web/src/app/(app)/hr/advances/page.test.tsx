import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Page now has a role gate (SEC fix: this page previously rendered for any
// authenticated user with no check at all) -- default to an authorized role
// so the existing content tests below keep exercising the real page body;
// the dedicated gate test overrides this per-call.
const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn(() => ["hr_admin"]) }));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: getSessionRolesMock,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

// GAP-HR-ADVANCES-03/07: RequestAdvanceForm is now a real "use client"
// next-intl consumer (useTranslations), which throws without a
// NextIntlClientProvider (see RequestAdvanceForm.test.tsx, which wraps it
// directly). This suite is testing AdvancesPage's own role-gate and
// table-mapping behavior, not the form, so it's stubbed out here rather
// than pulling a provider into every test below.
vi.mock("./RequestAdvanceForm", () => ({
  RequestAdvanceForm: () => null,
}));

import AdvancesPage from "./page";

describe("AdvancesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
  });

  it("shows Access restricted instead of the form/table for a role outside ADVANCE_ROLES (regression: this page had no gate at all)", async () => {
    // GAP-HR-ADVANCES-03 added "employee" to ADVANCE_ROLES for self-service,
    // so "employee" is no longer a role this gate denies -- use a role with
    // no plausible claim on this page at all.
    getSessionRolesMock.mockReturnValue(["citizen"]);
    const ui = await AdvancesPage();
    render(ui);
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(screen.queryByText("Request Advance")).not.toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  // fetchJson itself is mocked (as everywhere else in this suite), which
  // bypasses getData()'s own mapResponse/mapAdvances -- so these mocks
  // supply data already in mapAdvances' own output shape, exercising the
  // same real mapAdvances() function directly for precision.
  it("shows '—', never a UUID, when the backend row has no resolved employee name", async () => {
    // GAP-HR-ADVANCES-01: services/hrms-service's hrms_salary_advances table
    // only ever has a flat employee_id column; the backend now resolves
    // employeeName/employeeNo via the shared batchEmployees helper when
    // possible, but a genuinely unresolvable id (e.g. a deleted employee
    // record) must render "—", never the raw UUID.
    const { mapAdvances } = await import("./mapAdvances");
    fetchJsonMock.mockResolvedValue({
      data: mapAdvances([
        { id: "adv-1", employeeId: "emp-77", amountMinor: 500000, purpose: "Medical", recoveryMonths: 6, requestDate: "2026-07-01", status: "pending" },
      ]),
      source: "api",
    });

    const ui = await AdvancesPage();
    render(ui);

    expect(screen.queryByText("emp-77")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows the resolved employee name and number when present", async () => {
    const { mapAdvances } = await import("./mapAdvances");
    fetchJsonMock.mockResolvedValue({
      data: mapAdvances([
        { id: "adv-2", employeeId: "emp-88", employeeName: "Sunita Devi", employeeNo: "E-88", amountMinor: 300000, purpose: "Festival", recoveryMonths: 3, requestDate: "2026-07-01", status: "pending" },
      ]),
      source: "api",
    });

    const ui = await AdvancesPage();
    render(ui);

    expect(screen.getByText("Sunita Devi (E-88)")).toBeInTheDocument();
  });

  it("GAP-HR-ADVANCES-02: counts the 'active' backend status as Approved (display remap, not a wire rename)", async () => {
    const { mapAdvances } = await import("./mapAdvances");
    fetchJsonMock.mockResolvedValue({
      data: mapAdvances([
        { id: "a1", employeeId: "e1", employeeName: "A", amountMinor: 100000, purpose: "x", recoveryMonths: 1, requestDate: "2026-01-01", status: "active" },
        { id: "a2", employeeId: "e2", employeeName: "B", amountMinor: 100000, purpose: "x", recoveryMonths: 1, requestDate: "2026-01-01", status: "pending" },
        { id: "a3", employeeId: "e3", employeeName: "C", amountMinor: 100000, purpose: "x", recoveryMonths: 1, requestDate: "2026-01-01", status: "rejected" },
      ]),
      source: "api",
    });

    const ui = await AdvancesPage();
    render(ui);

    // Each of Approved/Pending/Rejected appears twice: once as its StatCard
    // label (always present regardless of data) and once as the one
    // matching row's StatusPill text in this 3-row (1 active, 1 pending, 1
    // rejected) fixture -- confirming the 'active' row is the one counted
    // under "Approved", not left uncounted or double-counted elsewhere.
    expect(screen.getAllByText("Approved")).toHaveLength(2);
    expect(screen.getAllByText("Pending")).toHaveLength(2);
    expect(screen.getAllByText("Rejected")).toHaveLength(2);
  });

  it("does not render Approve/Reject actions for a manager (not in ADVANCE_DECIDE_ROLES)", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    const { mapAdvances } = await import("./mapAdvances");
    fetchJsonMock.mockResolvedValue({
      data: mapAdvances([
        { id: "a1", employeeId: "e1", employeeName: "A", amountMinor: 100000, purpose: "x", recoveryMonths: 1, requestDate: "2026-01-01", status: "pending" },
      ]),
      source: "api",
    });

    const ui = await AdvancesPage();
    render(ui);

    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  // GAP-HR-ADVANCES-05: "officer"/"finance_admin" are in ADVANCE_ROLES (page
  // access) but not in DIRECTORY_ROLES (GET /v1/hrms/employees) and have no
  // "employee" role to self-file -- the create form must not render at all
  // for them (it could only ever 403 on the picker), replaced by a
  // view-only note.
  describe("GAP-HR-ADVANCES-05: no directory access and no self-service role", () => {
    for (const role of ["officer", "finance_admin"]) {
      it(`shows a view-only note instead of the request form for ["${role}"] alone`, async () => {
        getSessionRolesMock.mockReturnValue([role]);
        fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

        const ui = await AdvancesPage();
        render(ui);

        expect(screen.getByText(/view-only access to salary advances/i)).toBeInTheDocument();
      });
    }

    it("does NOT show the view-only note for hr_officer (has directory access)", async () => {
      getSessionRolesMock.mockReturnValue(["hr_officer"]);
      fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

      const ui = await AdvancesPage();
      render(ui);

      expect(screen.queryByText(/view-only access to salary advances/i)).not.toBeInTheDocument();
    });

    it("does NOT show the view-only note for a plain employee (self-service path)", async () => {
      getSessionRolesMock.mockReturnValue(["employee"]);
      fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

      const ui = await AdvancesPage();
      render(ui);

      expect(screen.queryByText(/view-only access to salary advances/i)).not.toBeInTheDocument();
    });

    it("does NOT show the view-only note for manager (has directory access)", async () => {
      getSessionRolesMock.mockReturnValue(["manager"]);
      fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

      const ui = await AdvancesPage();
      render(ui);

      expect(screen.queryByText(/view-only access to salary advances/i)).not.toBeInTheDocument();
    });
  });
});
