import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import PfStatutoryPage from "./page";

describe("PfStatutoryPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the PF ledger", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "1", employeeId: "e1", period: "2026-06", basicMinor: 5000000, empContribMinor: 600000, erContribMinor: 600000 }],
      source: "api",
    });
    const ui = await PfStatutoryPage();
    render(ui);
    expect(screen.getByText("e1")).toBeInTheDocument();
  });

  it("renders an empty state when there are no PF records", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await PfStatutoryPage();
    render(ui);
    expect(screen.getByText("No PF records")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the loader errors", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await PfStatutoryPage();
    render(ui);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
