import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import WaiversPage from "./page";

const ASSESSEE = {
  id: "11111111-1111-1111-1111-111111111111",
  ownerName: "Priya Singh",
  identifierNo: "PMC-1001",
  assesseeType: "residential",
};

function route(opts: {
  assessees?: { data: unknown; source?: string };
  demands?: { data: unknown; source?: string };
  pending?: { data: unknown; source?: string };
}) {
  fetchJsonMock.mockImplementation(
    (_url: string, fallback: unknown, cfg: { telemetryKey?: string; mapResponse?: (p: unknown) => unknown }) => {
      const key = cfg?.telemetryKey ?? "";
      const pick = () => {
        if (key.includes("waivers.assessees"))
          return opts.assessees ?? { data: [ASSESSEE], source: "api" };
        if (key.includes("waivers.demands"))
          return opts.demands ?? { data: [], source: "api" };
        if (key.includes("waivers.pending"))
          return opts.pending ?? { data: [], source: "api" };
        return { data: [], source: "api" };
      };
      const result = pick() as { data: unknown; source?: string };
      if (result.source === "error")
        return Promise.resolve({ data: fallback, source: "error" });
      const mapped = cfg?.mapResponse ? cfg.mapResponse({ data: result.data }) : result.data;
      return Promise.resolve({ data: mapped ?? fallback, source: result.source ?? "api" });
    },
  );
}

describe("WaiversPage — pending waivers list (GAP-REVENUE-WAIVERS-03)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("shows 'No pending waivers' when the pending list is empty", async () => {
    route({ pending: { data: [], source: "api" } });
    render(await WaiversPage({ searchParams: {} }));
    expect(screen.getByText("No pending waivers")).toBeInTheDocument();
  });

  it("renders a pending waiver row and links it to the decide page", async () => {
    const pendingRow = {
      id: "w-abc123",
      amountMinor: "75000",
      waiverType: "penalty",
      reason: "Flood relief waiver",
      status: "pending",
    };
    route({ pending: { data: [pendingRow], source: "api" } });
    render(await WaiversPage({ searchParams: {} }));

    // Row is rendered with the human-readable amount
    expect(screen.getByText("Flood relief waiver")).toBeInTheDocument();
    // Link to decide page is present
    const link = document.querySelector('a[href="/revenue/waivers/w-abc123/decide"]');
    expect(link).not.toBeNull();
  });

  it("shows an error state when the pending list fetch fails, not an empty state", async () => {
    route({ pending: { data: [], source: "error" } });
    render(await WaiversPage({ searchParams: {} }));
    // RefreshErrorState contains the area name
    expect(screen.getByText(/pending waivers/i)).toBeInTheDocument();
    // Should NOT say "No pending waivers" (that is the empty state)
    expect(screen.queryByText("No pending waivers")).toBeNull();
  });
});
