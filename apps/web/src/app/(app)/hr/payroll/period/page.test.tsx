import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import PayrollPeriodPage from "./page";

describe("PayrollPeriodPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("reads real payroll runs, not Finance's unrelated GL period-close records", async () => {
    // Regression test: this page used to call GET /api/v1/finance/periods
    // (Finance's period-close endpoint) even though its own Row shape
    // (month/employeesProcessed/grossPayout/...) describes a payroll run.
    // It must go through getPayrollRunDetails(), which calls the real
    // GET /api/v1/payroll/runs.
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    await PayrollPeriodPage();

    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    expect(fetchJsonMock.mock.calls[0][0]).toBe("/api/v1/payroll/runs");
  });

  it("does not divide already-rupee amounts by 100 again", async () => {
    // PayrollRunDetail.grossAmount/netAmount/deductions are already rupees;
    // rendering them via DataTable's cellType:"amount" (which assumes minor
    // units) would silently show ₹5,000.00 instead of ₹5,00,000.00.
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "run-1", runDate: "2026-08-01", payPeriod: "August 2026", employeeCount: 10, grossAmount: 500000, netAmount: 430000, deductions: 70000, status: "paid" },
      ],
      source: "api",
    });

    const ui = await PayrollPeriodPage();
    render(ui);

    expect(screen.getByText("₹5,00,000.00")).toBeInTheDocument();
    expect(screen.queryByText("₹5,000.00")).not.toBeInTheDocument();
  });

  // GAP-PAYROLL-RUNS-01: the period summary renders run money through the same adapter as the runs list and
  // the run detail, so one run shows one figure everywhere -- exact paise first, rupee float only as a fallback.
  it("renders the exact paise strings (grossMinor/netMinor/deductionsMinor) in preference to the rupee floats", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "run-1", runDate: "2026-08-01", payPeriod: "August 2026", employeeCount: 10, grossAmount: 1, netAmount: 1, deductions: 1, grossMinor: "15000000", netMinor: "12345678", deductionsMinor: "2654322", status: "paid" },
      ],
      source: "api",
    });
    render(await PayrollPeriodPage());
    expect(screen.getByText("₹1,50,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹1,23,456.78")).toBeInTheDocument();
    expect(screen.getByText("₹26,543.22")).toBeInTheDocument();
  });

  it("a run with no money fields shows dashes, not a fabricated ₹0.00", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "run-2", runDate: "2026-08-01", payPeriod: "August 2026", employeeCount: 10, status: "draft" }],
      source: "api",
    });
    render(await PayrollPeriodPage());
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
  });

  it("tells the truth on a fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await PayrollPeriodPage();
    render(ui);

    expect(screen.getByText("Couldn't load payroll periods — showing nothing")).toBeInTheDocument();
  });
});
