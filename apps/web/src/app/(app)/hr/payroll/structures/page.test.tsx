import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import PayStructuresPage from "./page";

describe("PayStructuresPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of pay structures", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "s1", name: "Standard Grade Pay", isDefault: true, status: "active" },
        { id: "s2", name: "Contractual Pay", isDefault: false, status: "active" },
      ],
      source: "api",
    });

    const ui = await PayStructuresPage();
    render(ui);

    expect(screen.getByText("Standard Grade Pay")).toBeInTheDocument();
    expect(screen.getByText("Contractual Pay")).toBeInTheDocument();
  });

  it("renders an empty state when there are no structures", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await PayStructuresPage();
    render(ui);

    expect(screen.getByText("No pay structures yet")).toBeInTheDocument();
  });

  it("notes that the component builder API is not yet available, without fabricating data", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await PayStructuresPage();
    render(ui);

    expect(screen.getByText("Component builder not yet available")).toBeInTheDocument();
  });
});
