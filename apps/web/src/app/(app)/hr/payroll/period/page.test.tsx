import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import PayrollPeriodPage from "./page";
import enMessages from "@/messages/en.json";

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

const RUN = (over: Record<string, unknown>) => ({
  id: "run-x", runDate: "2026-08-31", payPeriod: "2026-08", employeeCount: 10,
  grossAmount: 500000, netAmount: 430000, deductions: 70000, status: "paid", ...over,
});

/** Value shown by the stat tile with this label (StatCard renders .lab then .val). */
function tile(container: HTMLElement, label: string): string | null | undefined {
  const lab = Array.from(container.querySelectorAll(".lab")).find((el) => el.textContent === label);
  return lab?.nextElementSibling?.textContent;
}

describe("PayrollPeriodPage -- stat tiles (GAP-PAYROLL-PERIOD-02)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("splits [paid, approved, failed, draft] so Paid + In progress + Failed equals Total", async () => {
    // "approved" is not a wire status; it is the probe for "an unrecognised
    // status still lands in a tile" (the old Completed/Processing pair dropped it).
    fetchJsonMock.mockResolvedValue({
      data: [
        RUN({ id: "r1", payPeriod: "2026-05", status: "paid" }),
        RUN({ id: "r2", payPeriod: "2026-06", status: "approved" }),
        RUN({ id: "r3", payPeriod: "2026-07", status: "failed" }),
        RUN({ id: "r4", payPeriod: "2026-08", status: "draft" }),
      ],
      source: "api",
    });
    const { container } = render(await PayrollPeriodPage());

    const total = Number(tile(container, "Total"));
    expect(total).toBe(4);
    expect(tile(container, "Paid")).toBe("1");
    expect(tile(container, "In progress")).toBe("2");
    expect(tile(container, "Failed")).toBe("1");
    expect(Number(tile(container, "Paid")) + Number(tile(container, "In progress")) + Number(tile(container, "Failed"))).toBe(total);
  });

  it("shows the LATEST run's headcount, not the sum across every month", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        RUN({ id: "r1", payPeriod: "2026-07", employeeCount: 120 }),
        RUN({ id: "r3", payPeriod: "2026-09", employeeCount: 150 }),
        RUN({ id: "r2", payPeriod: "2026-08", employeeCount: 140 }),
      ],
      source: "api",
    });
    const { container } = render(await PayrollPeriodPage());

    expect(tile(container, "Employees (latest run)")).toBe("150");
    expect(container.textContent).not.toContain("410"); // 120 + 140 + 150: the old cross-month sum
  });

  it("shows em dashes (not zeros) when the runs could not be loaded", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const { container } = render(await PayrollPeriodPage());

    for (const label of ["Total", "Paid", "In progress", "Failed", "Employees (latest run)"]) {
      expect(tile(container, label)).toBe("—");
    }
  });

  it("shows an em dash for the headcount when there are no runs yet, while the counts are a true zero", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const { container } = render(await PayrollPeriodPage());

    expect(tile(container, "Total")).toBe("0");
    expect(tile(container, "Employees (latest run)")).toBe("—");
  });
});

describe("PayrollPeriodPage -- what it claims to be (GAP-PAYROLL-PERIOD-01)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("is titled as a run history, not as period management it does not offer", async () => {
    fetchJsonMock.mockResolvedValue({ data: [RUN({})], source: "api" });
    render(await PayrollPeriodPage());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Payroll Runs by Period");
    expect(screen.queryByText("Payroll Periods")).not.toBeInTheDocument();
  });

  it("no en copy for this route (page + HR dashboard tile) promises opening, closing or locking a period", () => {
    const copy = [
      enMessages.payrollPeriod.title,
      enMessages.payrollPeriod.subtitle,
      enMessages.payrollPeriod.cardTitle,
      enMessages.payrollPeriod.emptyTitle,
      enMessages.payrollPeriod.emptyMessage,
      enMessages.hr.payrollPeriod,
      enMessages.hr.payrollPeriodDesc,
    ].join(" | ");
    expect(copy).not.toMatch(/clos|lock|open|control/i);
  });

  it("links each row to its run detail page", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [RUN({ id: "11111111-aaaa-4000-8000-000000000001", payPeriod: "2026-08" })],
      source: "api",
    });
    render(await PayrollPeriodPage());

    expect(screen.getByRole("link", { name: "Open 2026-08" })).toHaveAttribute("href", "/hr/payroll/11111111-aaaa-4000-8000-000000000001");
  });
});
