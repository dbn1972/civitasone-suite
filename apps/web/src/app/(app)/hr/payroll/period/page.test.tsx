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

  it("tells the truth on a fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await PayrollPeriodPage();
    render(ui);

    expect(screen.getByText("Couldn't load payroll periods — showing nothing")).toBeInTheDocument();
  });
});
