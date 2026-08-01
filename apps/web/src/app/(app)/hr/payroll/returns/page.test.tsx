import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ReturnsPage from "./page";

describe("ReturnsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders Form-24Q deductees and Form-26Q data when both are populated", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("form24q")) {
        return Promise.resolve({
          data: {
            formType: "24Q",
            fy: "2025-26",
            quarter: "Q1",
            deducteeCount: 1,
            deductees: [{ employeeId: "e1", pan: "ABCDE1234F", panFlag: "", name: "Asha Verma", tdsDeducted: 5000, tdsDeposited: 5000, periods: ["2025-04"] }],
            totalTdsDeducted: 5000,
            totalTdsDeposited: 5000,
            reconciliation: { matched: true },
            note: "reconciled",
          },
          source: "api",
        });
      }
      return Promise.resolve({
        data: {
          formType: "26Q",
          fy: "2025-26",
          quarter: "Q1",
          deducteeCount: 0,
          deductees: [],
          totalTdsDeductedMinor: "0",
          populated: false,
          reconciliation: { matched: true },
          note: "No non-salary TDS for this period. Population requires a non-salary deduction feed.",
        },
        source: "api",
      });
    });

    const ui = await ReturnsPage({ searchParams: { fy: "2025-26", quarter: "Q1" } });
    render(ui);

    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByText("Non-salary TDS not yet populated")).toBeInTheDocument();
  });

  it("renders an empty state with a force-file option when Form-24Q is blocked or missing", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });

    const ui = await ReturnsPage({ searchParams: { fy: "2025-26", quarter: "Q1" } });
    render(ui);

    expect(screen.getByText("No Form-24Q data for FY 2025-26 Q1")).toBeInTheDocument();
    expect(screen.getByText("File anyway — bypass reconciliation (force)")).toBeInTheDocument();
  });
});
