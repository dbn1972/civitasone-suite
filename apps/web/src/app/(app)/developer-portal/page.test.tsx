import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { APIKeySummary } from "@civitasone/types";

const getAPIKeysMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getAPIKeys: (...a: unknown[]) => getAPIKeysMock(...a),
}));

// Also stub the barrel path the page actually imports from (relative ds).
vi.mock("../../_data/loaders", () => ({
  getAPIKeys: (...a: unknown[]) => getAPIKeysMock(...a),
}));

import DeveloperPortalPage from "./page";

function key(partial: Partial<APIKeySummary> & Pick<APIKeySummary, "id" | "keyName" | "status">): APIKeySummary {
  return {
    keyPrefix: "ak_live",
    createdBy: "u1",
    createdAt: "2026-01-15T00:00:00.000Z",
    scopes: ["read"],
    ...partial,
  };
}

describe("DeveloperPortalPage — truthful states (developer-portal batch1)", () => {
  beforeEach(() => getAPIKeysMock.mockReset());

  // GAP-DEVELOPER-PORTAL-HOME-01 (FAILMASK)
  it("on fetch error shows a retryable error, no fabricated '0' key counts, and hides the keys card", async () => {
    getAPIKeysMock.mockResolvedValue({ data: [], source: "error" });
    render(await DeveloperPortalPage());

    // honest, retryable error surfaced
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();

    // the key-count stat cards must NOT render as the fact "0"
    expect(screen.queryByText("API keys issued")).toBeNull();
    expect(screen.queryByText("Active keys")).toBeNull();

    // recent-keys card is hidden on error
    expect(screen.queryByText("Recently issued API keys")).toBeNull();

    // capability section still renders (static)
    expect(screen.getByText("Platform capabilities")).toBeTruthy();
  });

  // GAP-DEVELOPER-PORTAL-HOME-01 (real zero)
  it("on a genuine empty success shows 0 key counts with no error state", async () => {
    getAPIKeysMock.mockResolvedValue({ data: [], source: "api" });
    render(await DeveloperPortalPage());

    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    expect(screen.getByText("API keys issued").closest(".stat")).toHaveTextContent("0");
    expect(screen.getByText("Active keys").closest(".stat")).toHaveTextContent("0");
  });

  // GAP-DEVELOPER-PORTAL-HOME-02 (roadmap accuracy)
  it("links API Reference to /docs/api and the demo Sandbox to /sandbox", async () => {
    getAPIKeysMock.mockResolvedValue({ data: [], source: "api" });
    render(await DeveloperPortalPage());

    expect(screen.getByRole("link", { name: /open api reference/i })).toHaveAttribute("href", "/docs/api");
    expect(screen.getByRole("link", { name: /open demo sandbox/i })).toHaveAttribute("href", "/sandbox");
  });

  // GAP-DEVELOPER-PORTAL-HOME-03 (FABRICATED): roadmap counts are not StatCards next to live keys
  it("does not present roadmap counts as live KPI stat cards", async () => {
    getAPIKeysMock.mockResolvedValue({ data: [], source: "api" });
    render(await DeveloperPortalPage());

    // The old telemetry-looking KPI StatCards are gone
    expect(screen.queryByText("Capabilities available")).toBeNull();
    expect(screen.queryByText("On the roadmap")).toBeNull();

    // Instead an explicitly labelled roadmap legend exists with matching counts.
    const legend = screen.getByRole("list", { name: /platform roadmap summary/i });
    expect(within(legend).getByText(/1 available/i)).toBeTruthy();
    expect(within(legend).getByText(/3 in preview/i)).toBeTruthy();
    expect(within(legend).getByText(/2 planned/i)).toBeTruthy();
  });

  // GAP-DEVELOPER-PORTAL-HOME-06 (THEME): no hard-coded white/hex tile backgrounds
  it("uses theme tokens (no #fff / hex) for capability tile backgrounds", async () => {
    getAPIKeysMock.mockResolvedValue({ data: [], source: "api" });
    const { container } = render(await DeveloperPortalPage());

    const capList = screen.getByRole("list", { name: /developer platform capabilities/i });
    const tiles = within(capList).getAllByRole("listitem");
    expect(tiles.length).toBe(6);
    for (const tile of tiles) {
      // inline style must reference a CSS var, never a literal #fff/hex
      const bg = (tile as HTMLElement).style.background;
      expect(bg).toMatch(/var\(--/);
      expect(bg).not.toMatch(/#fff|#f1f5f9|#ecfdf3|#eef2ff|#fffaeb/i);
    }
    // no leftover hard-coded hex anywhere in the rendered markup's inline styles
    expect(container.innerHTML).not.toMatch(/background:\s*#fff\b/i);
  });

  // GAP-DEVELOPER-PORTAL-HOME-01 (positive): a real key renders in the recent-keys card
  it("renders the recent-keys card on a successful non-empty load", async () => {
    getAPIKeysMock.mockResolvedValue({
      data: [key({ id: "k1", keyName: "CI deploy key", status: "active" })],
      source: "api",
    });
    render(await DeveloperPortalPage());

    expect(screen.getByText("Recently issued API keys")).toBeTruthy();
    expect(screen.getByText("CI deploy key")).toBeTruthy();
    expect(screen.getByText("API keys issued").closest(".stat")).toHaveTextContent("1");
  });
});
