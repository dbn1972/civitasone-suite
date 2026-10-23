import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const ME = "11111111-0000-4000-8000-0000000000aa";
const OTHER = "22222222-0000-4000-8000-0000000000bb";

const getSessionRolesMock = vi.fn(() => ["payroll_admin"]);
const getSessionUserIdMock = vi.fn<() => string | null>(() => ME);
vi.mock("@/lib/auth/roleGuard", async (io) => ({
  ...(await io<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: () => getSessionRolesMock(),
  getSessionUserId: () => getSessionUserIdMock(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }) }));

const getPayrollRunByIdMock = vi.fn();
const getPayrollRunDetailsMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({
  getPayrollRunById: (...a: unknown[]) => getPayrollRunByIdMock(...a),
  getPayrollRunDetails: (...a: unknown[]) => getPayrollRunDetailsMock(...a),
}));

import PayrollRunDetailPage from "./page";

function run(over: Record<string, unknown> = {}) {
  return {
    id: "run-1", runDate: "2026-09-30", payPeriod: "2026-09", employeeCount: 2,
    // legacy rupee floats deliberately DISAGREE with the paise strings: only the paise are rendered
    grossAmount: 1, netAmount: 1, deductions: 1,
    grossMinor: "50000000", netMinor: "42000000", deductionsMinor: "8000000",
    status: "processing", failureReason: null,
    createdBy: OTHER, approvedBy: null,
    salarySlips: [
      { id: "s1", employeeId: "e1", employeeName: "Asha Rao", gross: 1, deductions: 1, net: 1, grossMinor: "30000000", deductionsMinor: "5000000", netMinor: "25000000", status: "computed", issues: [] },
      { id: "s2", employeeId: "e2", employeeName: "Vikram Shah", gross: 1, deductions: 1, net: 1, grossMinor: "20000000", deductionsMinor: "3000000", netMinor: "17000000", status: "computed", issues: [] },
    ],
    suspendedEmployees: [],
    ...over,
  };
}

async function renderPage() {
  const ui = await PayrollRunDetailPage({ params: Promise.resolve({ id: "run-1" }) });
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("PayrollRunDetailPage", () => {
  beforeEach(() => {
    getPayrollRunByIdMock.mockReset();
    getPayrollRunDetailsMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
    getSessionUserIdMock.mockReturnValue(ME);
    getPayrollRunDetailsMock.mockResolvedValue({ data: [], source: "api" });
  });

  it("GAP-PAYROLL-HOME-01: every amount is rendered from the paise strings (not the legacy rupee floats)", async () => {
    getPayrollRunByIdMock.mockResolvedValue({ data: run(), source: "api" });
    await renderPage();
    expect(screen.getAllByText("₹5,00,000.00").length).toBeGreaterThan(0); // gross
    expect(screen.getAllByText("₹80,000.00").length).toBeGreaterThan(0); // deductions
    expect(screen.getAllByText("₹4,20,000.00").length).toBeGreaterThan(0); // net
    expect(screen.queryByText("₹1.00")).not.toBeInTheDocument();
    // per-slip rows
    expect(screen.getByText("₹3,00,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹2,50,000.00")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-HOME-01: the month-over-month comparison uses the previous run's paise total", async () => {
    getPayrollRunByIdMock.mockResolvedValue({ data: run(), source: "api" });
    getPayrollRunDetailsMock.mockResolvedValue({ data: [{ id: "run-0", payPeriod: "2026-08", grossMinor: "40000000", grossAmount: 9 }], source: "api" });
    const { container } = await renderPage();
    expect(getPayrollRunDetailsMock).toHaveBeenCalledWith({ limit: 1, month: "2026-08" });
    expect(container.textContent).toContain("↑ 25.0%");
  });

  it("GAP-PAYROLL-HOME-01: a failed previous-period fetch is unknown (no delta), and no prior run is a real ₹0.00", async () => {
    getPayrollRunByIdMock.mockResolvedValue({ data: run(), source: "api" });
    getPayrollRunDetailsMock.mockResolvedValue({ data: [], source: "error" });
    const a = await renderPage();
    expect(a.container.textContent).not.toContain("↑");
    a.unmount();

    getPayrollRunDetailsMock.mockResolvedValue({ data: [], source: "api" });
    const b = await renderPage();
    expect(screen.getByText("₹0.00")).toBeInTheDocument();
    b.unmount();
  });

  it("GAP-PAYROLL-DETAIL-02: the run's creator sees Approve disabled with the maker-checker hint", async () => {
    getSessionUserIdMock.mockReturnValue(ME);
    getPayrollRunByIdMock.mockResolvedValue({ data: run({ createdBy: ME }), source: "api" });
    await renderPage();
    expect(screen.getByRole("button", { name: /approve run/i })).toBeDisabled();
    expect(screen.getByText(/You created this run/)).toBeInTheDocument();
  });

  it("GAP-PAYROLL-DETAIL-02: a different payroll user can approve", async () => {
    getSessionUserIdMock.mockReturnValue(ME);
    getPayrollRunByIdMock.mockResolvedValue({ data: run({ createdBy: OTHER }), source: "api" });
    await renderPage();
    expect(screen.getByRole("button", { name: /approve run/i })).toBeEnabled();
  });

  it("GAP-PAYROLL-DETAIL-02: the approver sees Disburse disabled with the hint; the creator does not", async () => {
    getSessionUserIdMock.mockReturnValue(ME);
    getPayrollRunByIdMock.mockResolvedValue({ data: run({ status: "completed", createdBy: OTHER, approvedBy: ME }), source: "api" });
    const a = await renderPage();
    expect(screen.getByRole("button", { name: /disburse run/i })).toBeDisabled();
    expect(screen.getByText(/You approved this run/)).toBeInTheDocument();
    a.unmount();

    getSessionUserIdMock.mockReturnValue(OTHER);
    getPayrollRunByIdMock.mockResolvedValue({ data: run({ status: "completed", createdBy: OTHER, approvedBy: ME }), source: "api" });
    await renderPage();
    expect(screen.getByRole("button", { name: /disburse run/i })).toBeEnabled();
  });

  it("an older API that sends no createdBy / approvedBy never blocks the buttons (the server decides)", async () => {
    getPayrollRunByIdMock.mockResolvedValue({ data: run({ createdBy: undefined, approvedBy: undefined }), source: "api" });
    await renderPage();
    expect(screen.getByRole("button", { name: /approve run/i })).toBeEnabled();
  });

  it("the back link label is translated (no hard-coded English)", async () => {
    getPayrollRunByIdMock.mockResolvedValue({ data: null, source: "api" });
    await renderPage();
    expect(screen.getByRole("link", { name: "Back to Payroll" })).toHaveAttribute("href", "/hr/payroll");
  });
});
