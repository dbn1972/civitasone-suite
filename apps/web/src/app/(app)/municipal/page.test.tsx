import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// GAP-MUNICIPAL-HOME-02: the hub now filters by tenant module enablement, so
// stub the shared visibility helpers. Default: everything enabled (null list).
vi.mock("@/lib/moduleVisibility", () => ({
  getEnabledModules: vi.fn(async () => null),
  isModuleEnabled: (enabled: string[] | null, key: string) =>
    enabled === null ? true : enabled.includes(key),
}));

import Page from "./page";
import { MUNICIPAL_SERVICE_CATALOG, CITIZEN_LINK_COUNT } from "./_data/services";
import { getEnabledModules } from "@/lib/moduleVisibility";

const mockedEnabled = vi.mocked(getEnabledModules);

beforeEach(() => {
  mockedEnabled.mockReset();
  mockedEnabled.mockResolvedValue(null);
});

describe("Municipal hub page", () => {
  it("renders a card for every catalog service when all modules are enabled", async () => {
    render(await Page());
    for (const svc of MUNICIPAL_SERVICE_CATALOG) {
      expect(screen.getByRole("heading", { name: svc.label })).toBeInTheDocument();
    }
  });

  it("shows distinct officer-console and citizen-link counts (HOME-01)", async () => {
    render(await Page());
    // Citizen apply links counts only services with a manifest (11), not all 17.
    expect(CITIZEN_LINK_COUNT).toBe(11);
    const citizenStat = screen.getByText("Citizen apply links").closest(".stat");
    expect(citizenStat?.textContent).toContain(String(CITIZEN_LINK_COUNT));
    // The three stat values are not all identical any more.
    expect(screen.getByText("Officer consoles")).toBeInTheDocument();
    expect(screen.getAllByText("Municipal services").length).toBeGreaterThan(0);
  });

  it("uses officer-facing copy without internal spec vocabulary (HOME-03)", async () => {
    const { container } = render(await Page());
    expect(container.textContent).not.toMatch(/BRD/);
    expect(container.textContent).not.toMatch(/Sec5/);
    expect(container.textContent).not.toMatch(/Reference template/);
  });

  it("gives each service tile link a concise accessible name (HOME-05)", async () => {
    render(await Page());
    const tradeLinks = screen.getAllByRole("link", { name: "Trade Licence" });
    expect(tradeLinks.length).toBeGreaterThan(0);
    expect(tradeLinks[0]).toHaveAttribute("href", "/municipal/trade");
  });

  it("lists all Sec5 services in Quick links, not just the first 6 (HOME-04)", async () => {
    render(await Page());
    // Quick links use the officer applications href; every Sec5 service appears.
    const sec5 = MUNICIPAL_SERVICE_CATALOG.filter((s) => s.sec5);
    for (const svc of sec5) {
      expect(
        screen.getAllByRole("link", { name: svc.label }).some((a) =>
          a.getAttribute("href") === `/municipal/${svc.serviceKey}/applications`,
        ),
      ).toBe(true);
    }
  });

  it("hides tiles for disabled modules (HOME-02)", async () => {
    mockedEnabled.mockResolvedValue(
      MUNICIPAL_SERVICE_CATALOG.filter((s) => s.serviceKey !== "trade").map((s) => s.moduleKey),
    );
    render(await Page());
    expect(screen.queryByRole("heading", { name: "Trade Licence" })).not.toBeInTheDocument();
    // A still-enabled console is present.
    expect(screen.getByRole("heading", { name: "Fire NOC" })).toBeInTheDocument();
  });
});
