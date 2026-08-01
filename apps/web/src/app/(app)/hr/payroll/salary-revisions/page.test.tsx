import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import SalaryRevisionsPage from "./page";

describe("SalaryRevisionsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of salary revisions", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        {
          id: "sr1", employee_id: "e1", effective_date: "2026-04-01",
          old_basic_minor: 4000000, new_basic_minor: 4400000,
          old_gross_minor: 8000000, new_gross_minor: 8800000,
          revision_type: "annual_increment", order_no: "ORD-1",
        },
      ],
      source: "api",
    });

    const ui = await SalaryRevisionsPage();
    render(ui);

    expect(screen.getByText("e1")).toBeInTheDocument();
    expect(screen.getByText("Annual Increment")).toBeInTheDocument();
  });

  it("renders an empty state when there are no revisions", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await SalaryRevisionsPage();
    render(ui);

    expect(screen.getByText("No salary revisions yet")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await SalaryRevisionsPage();
    render(ui);

    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });
});
