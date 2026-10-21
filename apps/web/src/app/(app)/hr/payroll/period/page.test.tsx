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

  it("renders the integer-paise strings as rupees (5,00,000.00), not shifted by 100", async () => {
    // GAP-PAYROLL-HOME-01: the run totals are read from grossMinor / netMinor /
    // deductionsMinor (integer paise) and formatted once at the display edge. A
    // wrong divisor would show ₹5,000.00 or ₹5,00,00,000.00 instead.
    fetchJsonMock.mockResolvedValue({
      data: [
        {
          id: "run-1", runDate: "2026-08-01", payPeriod: "August 2026", employeeCount: 10,
          grossAmount: 500000, netAmount: 430000, deductions: 70000,
          grossMinor: "50000000", netMinor: "43000000", deductionsMinor: "7000000",
          status: "paid",
        },
      ],
      source: "api",
    });

    const ui = await PayrollPeriodPage();
    render(ui);

    expect(screen.getByText("₹5,00,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹4,30,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹70,000.00")).toBeInTheDocument();
    expect(screen.queryByText("₹5,000.00")).not.toBeInTheDocument();
  });

  it("does not fall back to the legacy rupee floats: a payload without the paise strings shows an em dash", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "run-2", runDate: "2026-08-01", payPeriod: "August 2026", employeeCount: 10, grossAmount: 500000, netAmount: 430000, deductions: 70000, status: "paid" },
      ],
      source: "api",
    });

    const ui = await PayrollPeriodPage();
    render(ui);

    expect(screen.queryByText("₹5,00,000.00")).not.toBeInTheDocument();
    expect(screen.queryByText("₹4,30,000.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("tells the truth on a fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await PayrollPeriodPage();
    render(ui);

    expect(screen.getByText("Couldn't load payroll periods — showing nothing")).toBeInTheDocument();
  });
});
