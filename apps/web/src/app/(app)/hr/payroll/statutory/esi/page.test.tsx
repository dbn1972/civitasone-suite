import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import EsiStatutoryPage from "./page";

describe("EsiStatutoryPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the ESI ledger", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "1", employeeId: "e1", period: "2026-06", grossMinor: 3000000, empContribMinor: 22500, erContribMinor: 97500 }],
      source: "api",
    });
    const ui = await EsiStatutoryPage();
    render(ui);
    expect(screen.getByText("e1")).toBeInTheDocument();
  });

  it("renders an empty state when there are no ESI records", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await EsiStatutoryPage();
    render(ui);
    expect(screen.getByText("No ESI records")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the loader errors", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await EsiStatutoryPage();
    render(ui);
    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });
});
