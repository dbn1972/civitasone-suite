import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// GAP-PAYROLL-STATUTORY-PERQUISITE-02/04: page now has a role gate (this
// page previously rendered -- including another employee's PAN -- for any
// /hr role at all) -- default to an authorized role so the existing content
// tests below keep exercising the real page body; the dedicated gate test
// overrides this per-call.
const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn(() => ["payroll_admin"]) }));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: getSessionRolesMock,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import PerquisitePage from "./page";

// UX-017: PerquisitePage (Server Component, getTranslations("perquisite"))
// also renders EmployeeFyLookup and PerquisiteComponentForm, both "use
// client" components that call useTranslations -- so every render needs a
// real NextIntlClientProvider in the tree, same pattern as
// hr/payroll/disbursement/page.test.tsx (tranche 9).
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PerquisitePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("denies a role with no payroll/HR privilege before fetching anything", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    const ui = await PerquisitePage({ searchParams: { employeeId: "e1", fy: "2026-27" } });
    renderPage(ui);
    expect(screen.getByText(/don.t have permission/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("prompts for employee and FY when none is selected", async () => {
    const ui = await PerquisitePage({ searchParams: {} });
    renderPage(ui);
    expect(screen.getByText("Select an employee and financial year")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders the Form 12BA statement when found, with the PAN masked", async () => {
    fetchJsonMock.mockResolvedValue({
      data: {
        formType: "12BA", fy: "2026-27", assessmentYear: "2027-28",
        employer: { name: "Govt", tan: "T1", pan: "P1" },
        employee: { employeeId: "e1", pan: "ABCDE1234F", name: "Test Employee", panFlag: "" },
        perquisites: [{ sl: 1, nature: "car", description: "", valueByEmployerMinor: 60000, amountRecoveredMinor: 10000, taxableValueMinor: 50000, value: 500 }],
        totalPerquisitesMinor: 50000, totalPerquisites: 500, note: "ok",
      },
      source: "api",
    });
    const ui = await PerquisitePage({ searchParams: { employeeId: "e1", fy: "2026-27" } });
    renderPage(ui);
    expect(screen.getByText("Test Employee")).toBeInTheDocument();
    // GAP-PAYROLL-STATUTORY-PERQUISITE-04: the full PAN must never appear.
    expect(screen.queryByText("ABCDE1234F")).not.toBeInTheDocument();
    expect(screen.getByText("ABCDE****F")).toBeInTheDocument();
    // GAP-PAYROLL-STATUTORY-PERQUISITE-06: employer/AY header now shown.
    expect(screen.getByText("Govt")).toBeInTheDocument();
    expect(screen.getByText("2027-28")).toBeInTheDocument();
  });

  it("renders an empty state on a genuine 404 (no perquisites on file)", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "api", status: 404 });
    const ui = await PerquisitePage({ searchParams: { employeeId: "e1", fy: "2026-27" } });
    renderPage(ui);
    expect(screen.getByText("No Form 12BA data")).toBeInTheDocument();
  });

  // GAP-PAYROLL-STATUTORY-PERQUISITE-01: a failed lookup (source:"error")
  // used to render the exact same "No Form 12BA data" EmptyState as a
  // genuine empty result -- an outage read as "this employee has no
  // perquisites". Any error status other than 404 must show the real error
  // affordance with a retry, not the empty-state copy.
  it("renders the error affordance (not the empty-state copy) when the lookup fails", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    const ui = await PerquisitePage({ searchParams: { employeeId: "e1", fy: "2026-27" } });
    renderPage(ui);
    expect(screen.queryByText("No Form 12BA data")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
  });
});
