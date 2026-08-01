import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import CorrectionsPage from "./page";

describe("CorrectionsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of salary corrections", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        {
          id: "c1",
          employee_id: "e1",
          component: "BASIC",
          effective_from: "2025-04-01",
          old_value_minor: 4000000,
          new_value_minor: 4500000,
          arrears_minor: 1500000,
          affected_periods: 3,
          reason: "Pay fixation",
          status: "pending",
          created_at: "2025-06-01T00:00:00Z",
        },
      ],
      source: "api",
    });

    const ui = await CorrectionsPage();
    render(ui);

    expect(screen.getByText("e1")).toBeInTheDocument();
    expect(screen.getByText("BASIC")).toBeInTheDocument();
  });

  it("renders an empty state when there are no corrections", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await CorrectionsPage();
    render(ui);

    expect(screen.getByText("No salary corrections yet")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await CorrectionsPage();
    render(ui);

    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });
});
