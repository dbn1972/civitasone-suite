import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import GratuityPage from "./page";

describe("GratuityPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the gratuity register", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "1", employeeId: "e1", yearsOfService: "12.50", gratuityMinor: 500000, status: "computed" }],
      source: "api",
    });
    const ui = await GratuityPage();
    render(ui);
    expect(screen.getByText("e1")).toBeInTheDocument();
  });

  it("renders an empty state when there are no gratuity records", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await GratuityPage();
    render(ui);
    expect(screen.getByText("No gratuity records")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the loader errors", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await GratuityPage();
    render(ui);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
