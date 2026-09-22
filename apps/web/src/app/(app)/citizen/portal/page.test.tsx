import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import CitizenPortalPage from "./page";

const MOCK_METRICS = { totalServices: 34, activeRequests: 128, resolvedThisMonth: 96, avgResolutionDays: 4 };

function mockCitizenLoader(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/citizen/portal/metrics")) return Promise.resolve(result);
    return Promise.resolve({ data: null, source: "api" });
  });
}

describe("CitizenPortalPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders real stat counts when the loader succeeds", async () => {
    mockCitizenLoader({ data: MOCK_METRICS, source: "api" });
    render(await CitizenPortalPage());
    expect(screen.getByText("statPublishedServices").closest(".stat")).toHaveTextContent("34");
    expect(screen.getByText("statActiveRequests").closest(".stat")).toHaveTextContent("128");
  });

  it("renders — for every stat, not a fabricated zero, when the loader fails", async () => {
    // Bug A / UX-013: `source` was already fetched here but only wired to
    // the DataSourceBadge -- never to the stat values.
    mockCitizenLoader({
      data: { totalServices: 0, activeRequests: 0, resolvedThisMonth: 0, avgResolutionDays: 0 },
      source: "error",
    });
    render(await CitizenPortalPage());
    expect(screen.getByText("statPublishedServices").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("statActiveRequests").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("statResolvedThisMonth").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("statAvgResolutionDays").closest(".stat")).toHaveTextContent("—");
  });
});
