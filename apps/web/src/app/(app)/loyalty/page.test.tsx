/**
 * GAP-LOYALTY-HOME-01: hub stat tiles show real KPIs from the live endpoints,
 * render "—" on failure (never a fabricated 0), and expose a retry affordance
 * when every stat call fails so operators can recover without a full reload.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import Page from "./page";

function statValue(label: string): string {
  const tiles = Array.from(document.querySelectorAll<HTMLElement>(".stat"));
  const match = tiles.find((t) => t.querySelector(".lab")?.textContent === label);
  if (!match) throw new Error(`no stat tile labelled "${label}"`);
  return match.querySelector(".val")?.textContent ?? "";
}


beforeEach(() => fetchJsonMock.mockReset());

describe("loyalty hub (GAP-LOYALTY-HOME-01)", () => {
  it("Given live data, shows real KPI counts — active members from meta.total, pending redemptions", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        data: {
          total: 42,
          lifetime: 0n,
        },
        source: "api",
      })
      .mockResolvedValueOnce({ data: 5, source: "api" });

    render(await Page());

    expect(statValue("Active members")).toBe("42");
    expect(statValue("Redemptions pending")).toBe("5");
  });

  it("Given all API calls fail, every stat shows '—' and the retry affordance is visible", async () => {
    // getLoyaltyStats calls fetchJson twice (members + redemptions); simulate both errors
    fetchJsonMock.mockResolvedValue({ data: { total: null, lifetime: 0n }, source: "error", status: 503 });

    render(await Page());

    expect(statValue("Active members")).toBe("—");
    expect(statValue("Points issued (lifetime)")).toBe("—");
    expect(statValue("Redemptions pending")).toBe("—");
    expect(screen.getByRole("link", { name: /Retry loading loyalty stats/i })).toBeInTheDocument();
  });

  it("Given one stat succeeds and others fail, no retry affordance (partial data shows '—' inline)", async () => {
    // Only members returns data; redemptions errors
    fetchJsonMock
      .mockResolvedValueOnce({ data: { total: 10, lifetime: 99000n }, source: "api" })
      .mockResolvedValueOnce({ data: null, source: "error", status: 503 });

    render(await Page());

    expect(statValue("Active members")).toBe("10");
    // Retry affordance is absent when at least one stat succeeded
    expect(screen.queryByRole("link", { name: /Retry loading loyalty stats/i })).not.toBeInTheDocument();
  });
});
