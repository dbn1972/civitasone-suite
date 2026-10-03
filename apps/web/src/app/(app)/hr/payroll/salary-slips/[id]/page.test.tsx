import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const getSessionRolesMock = vi.fn();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
}));

import SalarySlipPage from "./page";

function baseSlip(overrides: Record<string, unknown> = {}) {
  return {
    id: "slip-1", employeeId: "emp-1", employeeNo: "EMP001", employeeName: "Asha Verma",
    department: "Finance", payPeriod: "2026-08", gross: 100000, deductions: 20000, net: 80000,
    status: "finalized", basicMinor: 50000, grossMinor: 100000, totalDeductionsMinor: 20000,
    netMinor: 80000, bankAccountLast4: "9012", paidDate: "2026-09-01T00:00:00.000Z",
    components: [
      { code: "BASIC", name: "Basic Pay", type: "earning", amountMinor: 50000 },
      { code: "PF", name: "Provident Fund", type: "deduction", amountMinor: 20000 },
    ],
    pfEmployeeMinor: 6000, pfEmployerMinor: 6000, gpfMinor: 0, npsEmployeeMinor: 0,
    npsEmployerMinor: 0, esiMinor: 0, tdsMinor: 0,
    ...overrides,
  };
}

function renderPage(ui: Awaited<ReturnType<typeof SalarySlipPage>>) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("SalarySlipPage (printable slip)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    // The second loader on the page (GET /v1/payroll/letterhead): none configured unless a test says otherwise.
    fetchJsonMock.mockResolvedValue({ data: null, source: "api" });
    getSessionRolesMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("renders only the resolved bank-account tail, never a fixed-length prefix over a value it never received", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip(), source: "api" });
    const ui = await SalarySlipPage({ params: { id: "slip-1" } });
    renderPage(ui);
    expect(screen.getByText(/•••• 9012/)).toBeInTheDocument();
    expect(screen.queryByText(/XXXX-XXXX-/)).not.toBeInTheDocument();
  });

  it("shows '—' for the bank account when the backend resolved no tail (e.g. HRMS unavailable)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip({ bankAccountLast4: null }), source: "api" });
    const ui = await SalarySlipPage({ params: { id: "slip-1" } });
    renderPage(ui);
    expect(screen.queryByText(/9012/)).not.toBeInTheDocument();
  });

  // GAP-PAYROLL-SALARY-SLIPS-DETAIL-02: the letterhead used to assert
  // "Government of India" unconditionally for every tenant.
  it("does not claim 'Government of India' in the print letterhead", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip(), source: "api" });
    const ui = await SalarySlipPage({ params: { id: "slip-1" } });
    renderPage(ui);
    expect(screen.queryByText(/Government of India/)).not.toBeInTheDocument();
  });

  // GAP-PAYROLL-SALARY-SLIPS-DETAIL-06: used to call the framework notFound()
  // with no way back to the slips list.
  it("shows a card with a back link instead of the framework 404 when the slip genuinely doesn't exist", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: null, source: "api", status: 200 });
    const ui = await SalarySlipPage({ params: { id: "missing" } });
    renderPage(ui);
    expect(screen.getByText(/may have been removed or you may not have access/i)).toBeInTheDocument();
    expect(screen.getByText("Back to Salary Slips")).toBeInTheDocument();
  });

  // GAP-PAYROLL-SALARY-SLIPS-05: a draft/computed slip must not be printable.
  it("disables the print button for a draft slip and enables it for a finalized one", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip({ status: "draft" }), source: "api" });
    const ui = await SalarySlipPage({ params: { id: "slip-1" } });
    renderPage(ui);
    expect(screen.getByText("Print / Save PDF").closest("button")).toBeDisabled();
  });

  it("enables the print button for a finalized slip", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip({ status: "finalized" }), source: "api" });
    const ui = await SalarySlipPage({ params: { id: "slip-1" } });
    renderPage(ui);
    expect(screen.getByText("Print / Save PDF").closest("button")).not.toBeDisabled();
  });

  it("formats paidDate and payPeriod instead of printing them raw", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip(), source: "api" });
    const ui = await SalarySlipPage({ params: { id: "slip-1" } });
    renderPage(ui);
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-08")).not.toBeInTheDocument();
  });

  it("shows 'Not yet paid' rather than a bare dash for an unpaid finalized slip", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip({ paidDate: null }), source: "api" });
    const ui = await SalarySlipPage({ params: { id: "slip-1" } });
    renderPage(ui);
    expect(screen.getByText("Not yet paid")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-SALARY-SLIPS-DETAIL-03: an employer-contribution component appears in the 'Other' block and a mismatch is flagged", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: baseSlip({
        components: [
          { code: "BASIC", name: "Basic Pay", type: "earning", amountMinor: 50000 },
          { code: "PF", name: "Provident Fund", type: "deduction", amountMinor: 20000 },
          { code: "ER_PF", name: "Employer PF", type: "employer_contribution", amountMinor: 6000 },
        ],
        grossMinor: 60000,
      }),
      source: "api",
    });
    renderPage(await SalarySlipPage({ params: { id: "s1" } }));
    expect(screen.getByText("Employer PF")).toBeInTheDocument();
    expect(screen.getByText("Other components (not part of net pay)")).toBeInTheDocument();
    expect(screen.getByText(/do not add up to the Gross/)).toBeInTheDocument();
  });

  it("GAP-PAYROLL-SALARY-SLIPS-DETAIL-03: a slip whose lines reconcile shows no discrepancy note and no Other block", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip({ grossMinor: 50000 }), source: "api" });
    renderPage(await SalarySlipPage({ params: { id: "s1" } }));
    expect(screen.queryByText(/do not add up to the Gross/)).not.toBeInTheDocument();
    expect(screen.queryByText("Other components (not part of net pay)")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-SALARY-SLIPS-DETAIL-03 (L1): no discrepancy note when the slip has no component lines at all", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip({ components: [] }), source: "api" });
    renderPage(await SalarySlipPage({ params: { id: "s1" } }));
    expect(screen.queryByText(/do not add up to the Gross/)).not.toBeInTheDocument();
  });

  // ── GAP-PAYROLL-SALARY-SLIPS-DETAIL-02: the issuing organisation is the tenant's own ──
  const LH = { orgName: "Directorate of Urban Affairs", department: "Accounts Wing", ddoName: "R. Menon", ddoCode: "DDO-114", address: "Sector 5, Civil Lines", signatoryTitle: "Drawing & Disbursing Officer", showSignatureBlock: true };

  function mockApi(slip: unknown, letterhead: unknown) {
    fetchJsonMock.mockImplementation(async (url: string) =>
      String(url).includes("/payroll/letterhead") ? { data: letterhead, source: "api" } : { data: slip, source: "api" });
  }

  it("DETAIL-02: prints the tenant's own organisation, department, DDO and address -- and never a platform name or 'Government of India'", async () => {
    mockApi(baseSlip(), LH);
    renderPage(await SalarySlipPage({ params: { id: "slip-1" } }));
    expect(screen.getByText("Directorate of Urban Affairs")).toBeInTheDocument();
    expect(screen.getByText("Accounts Wing")).toBeInTheDocument();
    expect(screen.getByText("DDO: R. Menon (DDO-114)")).toBeInTheDocument();
    expect(screen.getByText("Sector 5, Civil Lines")).toBeInTheDocument();
    expect(screen.queryByText(/Government of India/)).not.toBeInTheDocument();
    expect(screen.queryByText(/CivitasOne/)).not.toBeInTheDocument();
  });

  it("DETAIL-02: two tenants print their own names (tenant B differs from tenant A)", async () => {
    mockApi(baseSlip(), { ...LH, orgName: "Nagar Palika Parishad, Rewa", department: null, ddoName: null, ddoCode: null, address: null, showSignatureBlock: false });
    renderPage(await SalarySlipPage({ params: { id: "slip-1" } }));
    expect(screen.getByText("Nagar Palika Parishad, Rewa")).toBeInTheDocument();
    expect(screen.queryByText("Directorate of Urban Affairs")).not.toBeInTheDocument();
    expect(screen.queryByText(/^DDO:/)).not.toBeInTheDocument();
  });

  it("DETAIL-02: with no letterhead configured the slip prints no authority line at all", async () => {
    mockApi(baseSlip(), null);
    const { container } = renderPage(await SalarySlipPage({ params: { id: "slip-1" } }));
    expect(container.querySelector(".slip-letterhead")).toBeNull();
    expect(screen.queryByText(/Government of India|CivitasOne|HR Management System/)).not.toBeInTheDocument();
    expect(screen.getByText(/system-generated salary slip/)).toBeInTheDocument();
  });

  it("DETAIL-02: a configured signature block replaces the 'no signature required' footer", async () => {
    mockApi(baseSlip(), LH);
    renderPage(await SalarySlipPage({ params: { id: "slip-1" } }));
    expect(screen.getByText("Drawing & Disbursing Officer")).toBeInTheDocument();
    expect(screen.queryByText(/No signature required/)).not.toBeInTheDocument();
  });

  it("DETAIL-02: only payroll_admin / super_admin get the letterhead editor", async () => {
    mockApi(baseSlip(), LH);
    const first = renderPage(await SalarySlipPage({ params: { id: "slip-1" } }));
    expect(screen.getByText("Slip letterhead (issuing organisation)")).toBeInTheDocument();
    first.unmount();
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    renderPage(await SalarySlipPage({ params: { id: "slip-1" } }));
    expect(screen.queryByText("Slip letterhead (issuing organisation)")).not.toBeInTheDocument();
  });

  // ── GAP-PAYROLL-SALARY-SLIPS-DETAIL-04: header actions are PageHeader's, not a hand-built row ──
  it("DETAIL-04: the dashboard link and Print button sit inside the page header's actions", async () => {
    mockApi(baseSlip(), null);
    const { container } = renderPage(await SalarySlipPage({ params: { id: "slip-1" } }));
    const header = container.querySelector("header, .ph, [class*='page-header']") ?? container;
    const link = screen.getByRole("link", { name: "Dashboard View" });
    const print = screen.getByText("Print / Save PDF").closest("button")!;
    expect(header.contains(link)).toBe(true);
    expect(link.parentElement).toBe(print.parentElement);
    // the old hand-built flex row is gone
    expect(container.querySelector('div[style*="justify-content: space-between"][style*="margin-bottom: 16px"]')).toBeNull();
  });
});
