import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// getEnabledModules reaches server-only loaders; stub the whole module so the
// page can render in jsdom. isModuleEnabled is re-implemented faithfully.
const getEnabledModulesMock = vi.fn();
vi.mock("@/lib/moduleVisibility", () => ({
  getEnabledModules: () => getEnabledModulesMock(),
  isModuleEnabled: (enabled: string[] | null, key: string | null) => {
    if (key === null) return true;
    if (!enabled) return true;
    const k = key.toLowerCase();
    return enabled.some((n) => n === k || n.includes(k) || k.includes(n));
  },
}));

// ReplayTourButton is a client component using useToast/useRouter; stub it.
vi.mock("./ReplayTourButton", () => ({ ReplayTourButton: () => <button>tour</button> }));

import HelpPage from "./page";

describe("Help Centre hub", () => {
  beforeEach(() => getEnabledModulesMock.mockReset());

  // GAP-HELP-HOME-01
  it("subtitle no longer promises guides for every part of the system", async () => {
    getEnabledModulesMock.mockResolvedValue(null);
    render(await HelpPage());
    const sub = screen.getByText(/Short guides for the main modules/i);
    expect(sub).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("every part of the system");
  });

  // GAP-HELP-HOME-01
  it("shows the 'other modules' note with a Helpdesk link", async () => {
    getEnabledModulesMock.mockResolvedValue(null);
    render(await HelpPage());
    expect(screen.getByText(/Guides for other modules are being added/i)).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /helpdesk/i });
    expect(links.some((a) => a.getAttribute("href") === "/helpdesk")).toBe(true);
  });

  // GAP-HELP-HOME-03: Finance enabled still shows Finance + Tenant Admin (null key).
  it("with enabled=['finance'] shows Finance and Office Admin, hides Procurement", async () => {
    getEnabledModulesMock.mockResolvedValue(["finance"]);
    render(await HelpPage());
    expect(screen.getByRole("heading", { name: "Finance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Office Admin" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Procurement" })).not.toBeInTheDocument();
  });

  // GAP-HELP-HOME-02: glossary is now searchable (the search box exists).
  it("renders the glossary search box", async () => {
    getEnabledModulesMock.mockResolvedValue(null);
    render(await HelpPage());
    expect(screen.getByRole("searchbox", { name: /search words/i })).toBeInTheDocument();
  });
});
