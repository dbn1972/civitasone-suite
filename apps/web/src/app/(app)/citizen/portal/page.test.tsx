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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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

  it("GAP-CITIZEN-PORTAL-01: avg resolution days renders to at most one decimal", async () => {
    mockCitizenLoader({ data: { ...MOCK_METRICS, avgResolutionDays: 6.3333333 }, source: "api" });
    render(await CitizenPortalPage());
    const card = screen.getByText("statAvgResolutionDays").closest(".stat");
    expect(card).toHaveTextContent("6.3");
    expect(card).not.toHaveTextContent("6.333");
  });

  it("GAP-CITIZEN-PORTAL-02: offers a retry affordance (not just a badge) when the loader fails", async () => {
    mockCitizenLoader({ data: MOCK_METRICS, source: "error" });
    render(await CitizenPortalPage());
    // RefreshErrorState renders a "Try again" button wired to router.refresh().
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("GAP-CITIZEN-PORTAL-03: Active Requests stat links to /citizen/requests", async () => {
    mockCitizenLoader({ data: MOCK_METRICS, source: "api" });
    render(await CitizenPortalPage());
    const link = screen.getByText("statActiveRequests").closest("a");
    expect(link).toHaveAttribute("href", "/citizen/requests");
  });
});
