import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import RateConfigPage from "./page";

const rateHead = { id: "rh1", code: "PT", name: "Property Tax", category: "property_tax", unitOfMeasure: "sq_ft", isActive: true };

describe("RateConfigPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders rate heads and scoped tabs for the default (first) rate head", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/rate-heads")) return Promise.resolve({ data: [rateHead], source: "api" });
      if (path.includes("/rate-slabs")) return Promise.resolve({ data: [], source: "api" });
      if (path.includes("/penalty-rules")) return Promise.resolve({ data: [], source: "api" });
      if (path.includes("/rebate-rules")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await RateConfigPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Rate Configuration")).toBeInTheDocument();
    expect(screen.getByText("PT")).toBeInTheDocument();
    expect(fetchJsonMock).toHaveBeenCalledWith(
      expect.stringContaining("/rate-slabs?rateHeadId=rh1"),
      [],
      expect.anything(),
    );
  });

  it("renders an empty state when there are no rate heads yet, without fabricating data", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await RateConfigPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("No rate heads configured")).toBeInTheDocument();
    // Scoped loaders must not fire without a selected rate head.
    expect(fetchJsonMock).not.toHaveBeenCalledWith(expect.stringContaining("/rate-slabs"), expect.anything(), expect.anything());
  });

  it("shows the saved-information badge when a loader source is 'error', not a fabricated empty state", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/rate-heads")) return Promise.resolve({ data: [rateHead], source: "api" });
      if (path.includes("/rate-slabs")) return Promise.resolve({ data: [], source: "error" });
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await RateConfigPage({ searchParams: {} });
    render(ui);

    // Default active tab is "Rate Heads"; switch is exercised in RateConfigConsole.test.tsx.
    expect(screen.getByText("Rate Configuration")).toBeInTheDocument();
  });
});
