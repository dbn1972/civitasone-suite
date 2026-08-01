import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import OffCyclePage from "./page";

describe("OffCyclePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of off-cycle runs", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        {
          id: "o1",
          run_type: "bonus",
          period: "2025-06",
          description: "Diwali bonus",
          total_amount_minor: 500000,
          total_tax_minor: 0,
          total_net_minor: 0,
          status: "draft",
          created_at: "2025-06-01T00:00:00Z",
        },
      ],
      source: "api",
    });

    const ui = await OffCyclePage();
    render(ui);

    expect(screen.getByText("Diwali bonus")).toBeInTheDocument();
    expect(screen.getByText("2025-06")).toBeInTheDocument();
  });

  it("renders an empty state when there are no off-cycle runs", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await OffCyclePage();
    render(ui);

    expect(screen.getByText("No off-cycle runs yet")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await OffCyclePage();
    render(ui);

    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });
});
