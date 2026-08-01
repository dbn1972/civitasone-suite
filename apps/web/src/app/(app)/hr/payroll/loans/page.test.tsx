import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import LoansPage from "./page";

describe("LoansPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("prompts for an employee search when no empId is given, without fabricating data", async () => {
    const ui = await LoansPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Search for an employee to see their loans")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders loans for the searched employee", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "l1", loanNo: "LN-1", loanType: "personal", principalMinor: "100000", outstandingMinor: "50000", emiMinor: "10000", tenureMonths: 10, status: "applied" }],
      source: "api",
    });

    const ui = await LoansPage({ searchParams: { empId: "11111111-1111-1111-1111-111111111111" } });
    render(ui);

    expect(screen.getByText("LN-1")).toBeInTheDocument();
  });

  it("shows the error data-source badge when the API fails for a searched employee", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await LoansPage({ searchParams: { empId: "11111111-1111-1111-1111-111111111111" } });
    render(ui);

    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });

  it("notes the recovery schedule endpoint is not available", async () => {
    const ui = await LoansPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Recovery schedule not yet available")).toBeInTheDocument();
  });
});
