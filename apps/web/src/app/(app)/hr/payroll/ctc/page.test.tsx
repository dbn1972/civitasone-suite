import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import CtcConfigPage from "./page";

describe("CtcConfigPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders configured CTC components", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "c1", component_code: "BASIC", component_name: "Basic Salary", calc_type: "pct_of_ctc", value: "40.0000", is_employer_cost: false, is_active: true },
        { id: "c2", component_code: "ER_PF", component_name: "Employer PF", calc_type: "pct_of_basic", value: "12.0000", is_employer_cost: true, is_active: true },
      ],
      source: "api",
    });

    const ui = await CtcConfigPage();
    render(ui);

    expect(screen.getByText("Basic Salary")).toBeInTheDocument();
    expect(screen.getByText("Employer PF")).toBeInTheDocument();
  });

  it("renders an empty state when no CTC config exists", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await CtcConfigPage();
    render(ui);

    expect(screen.getByText("No CTC configuration found")).toBeInTheDocument();
  });
});
