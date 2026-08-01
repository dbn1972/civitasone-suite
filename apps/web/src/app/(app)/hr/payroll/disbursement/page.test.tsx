import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import DisbursementPage from "./page";

describe("DisbursementPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  function mockResponses(overrides: { runs?: unknown; sponsor?: unknown; dsc?: unknown; source?: "api" | "error" } = {}) {
    const source = overrides.source ?? "api";
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/runs")) return Promise.resolve({ data: overrides.runs ?? [], source });
      if (path.includes("sponsor-bank-config")) return Promise.resolve({ data: overrides.sponsor ?? null, source });
      if (path.includes("dsc-config")) return Promise.resolve({ data: overrides.dsc ?? null, source });
      return Promise.resolve({ data: null, source });
    });
  }

  it("renders payroll runs eligible for disbursement", async () => {
    mockResponses({
      runs: [
        { id: "r1", payPeriod: "2026-07", employeeCount: 10, grossAmount: 100000, netAmount: 90000, status: "completed" },
      ],
    });

    const ui = await DisbursementPage();
    render(ui);

    // "2026-07" appears both as a table cell and as run-selector option text.
    expect(screen.getAllByText("2026-07").length).toBeGreaterThan(0);
    expect(screen.getByText("Generate & Download")).toBeInTheDocument();
  });

  it("renders the run's net amount as rupees, not divided by 100 again", async () => {
    // Regression test: PayrollRunDetailSchema's netAmount is already RUPEES
    // (payroll-service divides totalNetMinor by 100 before returning it), so
    // this table must NOT run it through formatMoney()/cellType:"amount" —
    // that treats the value as minor units and would show ₹900.00 instead of
    // the correct ₹90,000.00 on the screen used to confirm a bank transfer.
    mockResponses({
      runs: [
        { id: "r1", payPeriod: "2026-07", employeeCount: 10, grossAmount: 100000, netAmount: 90000, status: "completed" },
      ],
    });

    const ui = await DisbursementPage();
    render(ui);

    expect(screen.getByText("₹90,000.00")).toBeInTheDocument();
    expect(screen.queryByText("₹900.00")).not.toBeInTheDocument();
  });

  it("renders an empty state when there are no eligible runs", async () => {
    mockResponses({ runs: [] });

    const ui = await DisbursementPage();
    render(ui);

    expect(screen.getByText("No runs ready for a bank file")).toBeInTheDocument();
  });

  it("shows the error data-source badge when the API is unreachable", async () => {
    mockResponses({ source: "error" });

    const ui = await DisbursementPage();
    render(ui);

    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });

  it("notes the mandate list endpoint is not available, without fabricating data", async () => {
    mockResponses({});

    const ui = await DisbursementPage();
    render(ui);

    expect(screen.getByText("Mandate list not yet available")).toBeInTheDocument();
  });
});
