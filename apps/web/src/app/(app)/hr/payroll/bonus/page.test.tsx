import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import BonusPage from "./page";

describe("BonusPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of bonus records", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "b1", employee_id: "e1", fy: "2025-26", basic_minor: 5000000, bonus_pct: 8.33, bonus_amount_minor: 416500, status: "computed" },
      ],
      source: "api",
    });

    const ui = await BonusPage();
    render(ui);

    expect(screen.getByText("e1")).toBeInTheDocument();
    expect(screen.getByText("2025-26")).toBeInTheDocument();
  });

  it("renders an empty state when there are no bonus records", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await BonusPage();
    render(ui);

    expect(screen.getByText("No bonus records yet")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await BonusPage();
    render(ui);

    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });
});
