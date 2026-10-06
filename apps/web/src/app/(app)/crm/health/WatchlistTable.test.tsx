import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WatchlistTable } from "./WatchlistTable";
import type { NamedAccountHealthEntry } from "./health";

// F5-01: the Owner column resolves owner ids to names via the agent directory.
vi.mock("@/lib/crm/assignment", () => ({
  getAgents: vi.fn(async () => ({
    data: [{ agentId: "agent-9", name: "Meera Nair", activeLeads: 0, maxLeads: 10, available: true, onLeave: false }],
    source: "api",
  })),
}));

/**
 * GAP-CRM-HEALTH-05: the watchlist row offers an explicit "Log follow-up"
 * action so a clerk can start a follow-up without first drilling into the
 * account. It links to the account's health detail page, which hosts the
 * Create-Follow-up dialog.
 *
 * F5-01/F5-02: the table now also carries an Owner column (resolved to a name)
 * and a Last Contact column (latest activity timestamp, or "—").
 */
function entry(id: string, name: string, overrides: Partial<NamedAccountHealthEntry> = {}): NamedAccountHealthEntry {
  return {
    accountId: id,
    accountName: name,
    score: 20,
    band: "at_risk",
    computedAt: "2026-08-01T00:00:00.000Z",
    contributingFactors: [],
    storedScore: 20,
    version: 1,
    unresolved: false,
    ownerId: null,
    lastContactAt: null,
    ...overrides,
  } as unknown as NamedAccountHealthEntry;
}

describe("WatchlistTable follow-up action (GAP-CRM-HEALTH-05)", () => {
  it("renders a per-row 'Log follow-up' link that deep-links into the follow-up form", () => {
    render(<WatchlistTable entries={[entry("acc-1", "Bharat Steel")]} />);
    const link = screen.getByRole("link", { name: /Log follow-up/i });
    expect(link).toHaveAttribute("href", "/crm/health/acc-1?followUp=1");
  });
});

describe("WatchlistTable owner + last-contact columns (F5-01/F5-02)", () => {
  it("shows Owner and Last Contact column headers", () => {
    render(<WatchlistTable entries={[entry("acc-1", "Bharat Steel")]} />);
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Last Contact")).toBeInTheDocument();
  });

  it("renders 'Unassigned' and '—' when the account has no owner or contact", () => {
    render(<WatchlistTable entries={[entry("acc-1", "Bharat Steel")]} />);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("resolves the owner id to a name and formats the last-contact date", async () => {
    render(
      <WatchlistTable
        entries={[entry("acc-1", "Bharat Steel", { ownerId: "agent-9", lastContactAt: "2026-09-15T08:30:00.000Z" })]}
      />,
    );
    expect(await screen.findByText("Meera Nair")).toBeInTheDocument();
    // Never render the raw owner id.
    expect(screen.queryByText("agent-9")).not.toBeInTheDocument();
    // The last-contact date is formatted (en-IN day-month-year), not raw ISO.
    expect(screen.getByText(/Sept? 2026/)).toBeInTheDocument();
  });
});
