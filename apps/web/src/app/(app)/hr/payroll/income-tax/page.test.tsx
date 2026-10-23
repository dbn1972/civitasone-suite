import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// GAP-PAYROLL-INCOME-TAX-02: page now has a role gate (this page previously
// rendered for any /hr role at all, with no backend-DPDP-leak but a
// confusing 403/blank-table experience for manager/employee) -- default to
// an authorized role so the existing content tests below keep exercising
// the real page body; the dedicated gate test overrides this per-call.
const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn(() => ["payroll_admin"]) }));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: getSessionRolesMock,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import IncomeTaxPage from "./page";

function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const ROW = {
  id: "d1",
  employee: "Asha Rao",
  department: "Finance",
  grossIncome: "1200000",
  deductions80C: "150000",
  otherDeductions: "0",
  taxableIncome: "1050000",
  taxPayable: "95000",
  status: "submitted",
};

describe("IncomeTaxPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("denies a manager (not in the backend's READER_ROLES) without fetching", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    const ui = await IncomeTaxPage();
    renderPage(ui);
    expect(screen.getByText(/don.t have permission/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("admits a self-service employee (backend scopes them to their own row already)", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    fetchJsonMock.mockResolvedValue({ data: [ROW], source: "api" });
    const ui = await IncomeTaxPage();
    renderPage(ui);
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
  });

  it("shows a Department column alongside the existing Departments stat", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ROW], source: "api" });
    const ui = await IncomeTaxPage();
    renderPage(ui);
    expect(screen.getByText("Department")).toBeInTheDocument();
    expect(screen.getAllByText("Finance").length).toBeGreaterThan(0);
  });

  // GAP-PAYROLL-INCOME-TAX-04: traced against the real backend -- a
  // submitted declaration's status is always "submitted" (never the
  // "finalized"/"completed" literals the old bucket matched against), so it
  // must count under "Finalized", not fall through to Total-only. The pill
  // must also show a translated label, not the raw enum.
  it("shows a translated status label instead of the raw backend enum", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ROW], source: "api" });
    const ui = await IncomeTaxPage();
    renderPage(ui);
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(screen.queryByText("submitted")).not.toBeInTheDocument();
  });
});

/** Value shown by the stat tile with this label (StatCard renders .lab then .val). */
function tile(container: HTMLElement, label: string): string | null | undefined {
  const lab = Array.from(container.querySelectorAll(".lab")).find((el) => el.textContent === label);
  return lab?.nextElementSibling?.textContent;
}

// GAP-PAYROLL-INCOME-TAX-04: the DB CHECK also allows verified/approved, and a
// future status must not vanish from every tile but Total.
describe("IncomeTaxPage -- status tiles always account for every row", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("counts verified / approved / unknown statuses under Other so the tiles sum to Total", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { ...ROW, id: "1", employee: "A", status: "submitted" },
        { ...ROW, id: "2", employee: "B", status: "pending" },
        { ...ROW, id: "3", employee: "C", status: "verified" },
        { ...ROW, id: "4", employee: "D", status: "a-status-from-the-future" },
      ],
      source: "api",
    });
    const ui = await IncomeTaxPage();
    const { container } = render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(tile(container, "Total")).toBe("4");
    expect(tile(container, "Finalized")).toBe("1");
    expect(tile(container, "Pending")).toBe("1");
    expect(tile(container, "Other")).toBe("2");
    const sum = ["Finalized", "Pending", "Other"].reduce((n, l) => n + Number(tile(container, l)), 0);
    expect(sum).toBe(Number(tile(container, "Total")));
  });

  it("does not show an Other tile when every row has a known status", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ ...ROW, id: "1", status: "submitted" }, { ...ROW, id: "2", employee: "B", status: "pending" }],
      source: "api",
    });
    const ui = await IncomeTaxPage();
    const { container } = render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(tile(container, "Other")).toBeUndefined();
    expect(Number(tile(container, "Finalized")) + Number(tile(container, "Pending"))).toBe(Number(tile(container, "Total")));
  });

  it("shows em dashes (not zeros) for every tile when the list could not be loaded", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await IncomeTaxPage();
    const { container } = render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    for (const label of ["Total", "Finalized", "Pending", "Departments"]) expect(tile(container, label)).toBe("—");
    expect(tile(container, "Other")).toBeUndefined();
  });
});

// GAP-PAYROLL-INCOME-TAX-03
describe("IncomeTaxPage -- drill-in", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("opens the employee profile from a row, using the employee id (not the mixed-space row id)", async () => {
    const EMP = "22222222-bbbb-4000-8000-000000000002";
    // id is a DECLARATION id here; only employeeId may name the target.
    fetchJsonMock.mockResolvedValue({
      data: [{ ...ROW, id: "dec-99999999", employeeId: EMP }],
      source: "api",
    });
    const ui = await IncomeTaxPage();
    renderPage(ui);

    const link = screen.getByRole("link", { name: "Open Asha Rao" });
    expect(link).toHaveAttribute("href", `/hr/employees/${EMP}`);
    expect(link.getAttribute("href")).not.toContain("dec-99999999");
  });
});
