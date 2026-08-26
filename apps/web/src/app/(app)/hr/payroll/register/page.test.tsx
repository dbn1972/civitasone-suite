import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import PayrollRegisterPage from "./page";

describe("PayrollRegisterPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders register lines", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        {
          id: "r1",
          department_name: "Revenue",
          employee_count: 42,
          total_gross_minor: 50000000,
          total_deductions_minor: 5000000,
          total_net_minor: 45000000,
          total_pf_minor: 1000000,
          total_esi_minor: 200000,
          total_tds_minor: 800000,
          total_pt_minor: 100000,
          period: "2025-06",
        },
      ],
      source: "api",
    });

    const ui = await PayrollRegisterPage({ searchParams: { period: "2025-06" } });
    render(ui);

    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("2025-06")).toBeInTheDocument();
  });

  it("renders an empty state when there are no register lines", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await PayrollRegisterPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("No register lines")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await PayrollRegisterPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
