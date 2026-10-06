import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// Mirror the real useSeededResource outcome: an errored source with an empty
// seed resolves to "error-no-data"; otherwise "live".
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, seed: unknown[], source: string) => ({
    data: seed,
    provenance: source === "error" && seed.length === 0 ? "error-no-data" : "live",
    offline: false,
    cachedAt: null,
  }),
}));

import { UsageDisplay } from "./UsageDisplay";
import { usageBand, showUpgrade, WARN_PCT, CRIT_PCT } from "./thresholds";

const base = {
  resource: "api",
  label: "API Calls",
  icon: "📈",
  limit: 100,
  used: 50,
  unit: "calls",
  projectedOverageDate: null,
};

describe("thresholds (GAP-TENANT-ADMIN-USAGE-02)", () => {
  it("bands 89 as warning (amber) and shows Upgrade; bands 90 as critical", () => {
    expect(usageBand(89)).toBe("warning");
    expect(showUpgrade(89)).toBe(true);
    expect(usageBand(90)).toBe("critical");
    expect(WARN_PCT).toBe(70);
    expect(CRIT_PCT).toBe(90);
  });
});

describe("UsageDisplay — GAP-TENANT-ADMIN-USAGE-01 (error vs empty)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders a retry-able error state (not 'No usage data') when the fetch failed", () => {
    render(<UsageDisplay resources={[]} anyWarning={false} source="error" />);
    expect(screen.getByText(/Couldn't load — showing nothing/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/No usage data/i)).not.toBeInTheDocument();
  });

  it("renders 'No usage data' for a genuinely empty (successful) result", () => {
    render(<UsageDisplay resources={[]} anyWarning={false} source="api" />);
    expect(screen.getByText(/No usage data/i)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load/i)).not.toBeInTheDocument();
  });
});

describe("UsageDisplay — GAP-TENANT-ADMIN-USAGE-03 (unlimited)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows 'Unlimited' and no progress bar when percent is null", () => {
    render(
      <UsageDisplay
        resources={[{ ...base, limit: 0, used: 42, percent: null }]}
        anyWarning={false}
        source="api"
      />,
    );
    expect(screen.getByText(/\/ Unlimited calls/i)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

describe("UsageDisplay — GAP-TENANT-ADMIN-USAGE-04 (banner link) + USAGE-05 (a11y label)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders a working Upgrade link in the warning banner for a critical resource", () => {
    render(
      <UsageDisplay
        resources={[{ ...base, used: 95, limit: 100, percent: 95 }]}
        anyWarning
        source="api"
      />,
    );
    const banner = screen.getByRole("alert");
    const link = within(banner).getByRole("link", { name: /Upgrade your plan/i });
    expect(link).toHaveAttribute("href", "/tenant-admin/plans");
    // no "contact admin" dead copy
    expect(banner.textContent).not.toMatch(/contact admin/i);
  });

  it("renders the percent label as readable dark text outside the coloured bar", () => {
    render(
      <UsageDisplay
        resources={[{ ...base, used: 50, limit: 100, percent: 50 }]}
        anyWarning={false}
        source="api"
      />,
    );
    // The visible "50%" label is a sibling of the counts, not the bar fill.
    const bar = screen.getByRole("progressbar");
    expect(bar.textContent).not.toMatch(/50%/); // label no longer lives inside the fill
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});
