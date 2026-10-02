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

import PayslipDetailPage from "./page";

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

function renderPage(ui: Awaited<ReturnType<typeof PayslipDetailPage>>) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("PayslipDetailPage (dashboard view)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReset();
    getSessionRolesMock.mockReturnValue(["employee"]);
  });

  // GAP-PAYROLL-SLIPS-DETAIL-03: earnings/deductions used to be read from a
  // shape (earnings[]/deductionItems[]) the backend never actually sends --
  // every real slip showed "not available" for both tables.
  it("derives earnings and deductions from components[], not the old fictional earnings/deductionItems shape", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip(), source: "api" });
    const ui = await PayslipDetailPage({ params: { id: "slip-1" } });
    renderPage(ui);
    expect(screen.getByText("Basic Pay")).toBeInTheDocument();
    expect(screen.getByText("Provident Fund")).toBeInTheDocument();
    expect(screen.queryByText("Detailed earnings breakdown not available for this slip.")).not.toBeInTheDocument();
  });

  // GAP-PAYROLL-SLIPS-DETAIL-03: the real statutory columns, not the
  // fictional stat.pfEmployee/esiEmployee/esiEmployer shape.
  it("shows the real statutory columns and the employer-contribution note when an employer share is present", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip(), source: "api" });
    const ui = await PayslipDetailPage({ params: { id: "slip-1" } });
    renderPage(ui);
    expect(screen.getByText("PF (Employee)")).toBeInTheDocument();
    expect(screen.getByText("PF (Employer)")).toBeInTheDocument();
    expect(screen.getByText(/not deducted from your pay/i)).toBeInTheDocument();
    // GPF/NPS/ESI/TDS are all zero in this fixture -- must not render as
    // confusing "₹0.00" lines for contributions that don't apply.
    expect(screen.queryByText("GPF")).not.toBeInTheDocument();
  });

  // GAP-PAYROLL-SLIPS-DETAIL-01: a failed fetch used to render the exact
  // same "may have been removed or you may not have access" card as a real
  // 404 -- indistinguishable, even though one is retryable and the other
  // isn't.
  it("shows a retryable error (not the not-found card) when the fetch itself fails", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: null, source: "error", status: 500 });
    const ui = await PayslipDetailPage({ params: { id: "slip-1" } });
    renderPage(ui);
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
    expect(screen.queryByText(/may have been removed/i)).not.toBeInTheDocument();
  });

  it("still shows the not-found card for a genuine miss (fetch succeeded, slip is null)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: null, source: "api", status: 404 });
    const ui = await PayslipDetailPage({ params: { id: "missing" } });
    renderPage(ui);
    expect(screen.getByText(/may have been removed/i)).toBeInTheDocument();
  });

  // GAP-PAYROLL-SLIPS-DETAIL-04: slip.status.charAt(0) had no guard.
  it("never throws for an unrecognised status and falls back to the raw string", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip({ status: "weird_future_status" }), source: "api" });
    const ui = await PayslipDetailPage({ params: { id: "slip-1" } });
    expect(() => renderPage(ui)).not.toThrow();
    expect(screen.getByText("weird_future_status")).toBeInTheDocument();
  });

  // GAP-PAYROLL-SLIPS-DETAIL-06: back-nav used to point an employee at the
  // admin-only salary-slips list (a guaranteed 403 for them).
  it("points an employee's back-link at /hr/payroll, not the admin-only salary-slips list", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip(), source: "api" });
    const ui = await PayslipDetailPage({ params: { id: "slip-1" } });
    renderPage(ui);
    const back = screen.getByText("Back to Payroll").closest("a");
    expect(back).toHaveAttribute("href", "/hr/payroll");
  });

  it("points an admin's back-link at the salary-slips list", async () => {
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip(), source: "api" });
    const ui = await PayslipDetailPage({ params: { id: "slip-1" } });
    renderPage(ui);
    const back = screen.getByText("Back to Salary Slips").closest("a");
    expect(back).toHaveAttribute("href", "/hr/payroll/salary-slips");
  });

  // GAP-PAYROLL-SLIPS-DETAIL-05: a draft/computed slip must not be
  // downloadable.
  it("disables Download PDF for a draft slip", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip({ status: "draft" }), source: "api" });
    const ui = await PayslipDetailPage({ params: { id: "slip-1" } });
    renderPage(ui);
    const downloadEl = screen.getByText("Download PDF");
    expect(downloadEl.closest("a")).toBeNull();
    expect(downloadEl.closest("span")).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps Download PDF as a real link for a finalized slip", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip({ status: "finalized" }), source: "api" });
    const ui = await PayslipDetailPage({ params: { id: "slip-1" } });
    renderPage(ui);
    expect(screen.getByText("Download PDF").closest("a")).toHaveAttribute(
      "href",
      "/api/proxy/v1/payroll/slips/slip-1/pdf",
    );
  });

  it("keeps Download PDF as a real link for a paid slip (the only final status the backend can hold)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip({ status: "paid" }), source: "api" });
    const ui = await PayslipDetailPage({ params: { id: "slip-1" } });
    renderPage(ui);
    expect(screen.getByText("Download PDF").closest("a")).toHaveAttribute(
      "href",
      "/api/proxy/v1/payroll/slips/slip-1/pdf",
    );
  });

  // payroll_slips.status "exception" (negative net) is a real backend value:
  // it must render the slip with a translated label and a disabled download,
  // never the raw English enum or an enabled print.
  it("renders an exception slip with its translated label and Download PDF disabled", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: baseSlip({ status: "exception" }), source: "api" });
    const ui = await PayslipDetailPage({ params: { id: "slip-1" } });
    renderPage(ui);
    expect(screen.getByText(enMessages.salarySlipDashboard.status.exception)).toBeInTheDocument();
    expect(screen.queryByText("exception")).not.toBeInTheDocument();
    const downloadEl = screen.getByText("Download PDF");
    expect(downloadEl.closest("a")).toBeNull();
    expect(downloadEl.closest("span")).toHaveAttribute("aria-disabled", "true");
  });
});
