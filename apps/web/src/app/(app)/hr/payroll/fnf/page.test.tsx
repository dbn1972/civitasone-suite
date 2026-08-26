import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import FnfPage from "./page";

describe("FnfPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of F&F settlements", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "s1", employeeId: "e1", separationType: "retirement", separationDate: "2026-07-01", netPayableMinor: "500000", status: "settled" },
      ],
      source: "api",
    });

    const ui = await FnfPage();
    render(ui);

    // "retirement" appears both as a table cell and as a select option in the compute form.
    expect(screen.getAllByText("retirement").length).toBeGreaterThan(0);
  });

  it("renders an empty state when there are no settlements", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await FnfPage();
    render(ui);

    expect(screen.getByText("No F&F settlements yet")).toBeInTheDocument();
  });

  it("shows the error data-source badge on API failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await FnfPage();
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
