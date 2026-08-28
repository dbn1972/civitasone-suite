import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import PayrollRunsPage from "./page";

describe("PayrollRunsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("calls the real payroll-runs endpoint, not the nonexistent /api/v1/hrms/payroll/runs route", async () => {
    // Regression test: this page used to fetch "/api/v1/hrms/payroll/runs"
    // directly from a client-side useEffect -- confirmed live to 404
    // ("Route GET:/v1/hrms/payroll/runs not found") -- so the page always
    // rendered its error state. It must go through the shared
    // getPayrollRunDetails() loader, which calls the real
    // GET /api/v1/payroll/runs.
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    await PayrollRunsPage();

    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    expect(fetchJsonMock.mock.calls[0][0]).toBe("/api/v1/payroll/runs");
  });

  it("renders real runs with correctly-formatted rupee amounts and a working detail link", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "run-1", runDate: "2026-08-01", payPeriod: "August 2026", employeeCount: 42, grossAmount: 500000, netAmount: 430000, deductions: 70000, status: "paid" },
      ],
      source: "api",
    });

    const ui = await PayrollRunsPage();
    render(ui);

    expect(screen.getByRole("link", { name: "August 2026" })).toHaveAttribute("href", "/hr/payroll/run-1");
    expect(screen.getByText("₹5,00,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹4,30,000.00")).toBeInTheDocument();
  });

  it("points the empty-state CTA at the working /hr/payroll page, not the broken /hr/payroll/period page", async () => {
    // Regression test: the old empty-state CTA and the dashboard/quick-action
    // "Start Run"/"Run Payroll" buttons across the module all pointed at
    // /hr/payroll/period, which reads Finance's GL period-close records
    // (wrong service, wrong shape, wrong role gate) and has no create-run
    // form at all. The one real CreatePayrollRunForm lives at /hr/payroll.
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await PayrollRunsPage();
    render(ui);

    expect(screen.getByRole("link", { name: /Create first run/ })).toHaveAttribute("href", "/hr/payroll");
  });

  it("tells the truth on a fetch failure instead of a hardcoded generic error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await PayrollRunsPage();
    render(ui);

    expect(screen.getByText("Couldn't load payroll runs — showing nothing")).toBeInTheDocument();
  });
});
