import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WatchlistTable } from "./WatchlistTable";
import type { NamedAccountHealthEntry } from "./health";

/**
 * GAP-CRM-HEALTH-05: the watchlist row now offers an explicit "Log follow-up"
 * action so a clerk can start a follow-up without first drilling into the
 * account. It links to the account's health detail page, which hosts the
 * Create-Follow-up dialog. (An owner / last-contact column and a deep-link to a
 * prefilled form are deferred — see batch report — because the account summary
 * carries no owner and no prefillable follow-up route exists.)
 */
function entry(id: string, name: string): NamedAccountHealthEntry {
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
  } as unknown as NamedAccountHealthEntry;
}

describe("WatchlistTable follow-up action (GAP-CRM-HEALTH-05)", () => {
  it("renders a per-row 'Log follow-up' link that deep-links into the follow-up form", () => {
    render(<WatchlistTable entries={[entry("acc-1", "Bharat Steel")]} />);
    const link = screen.getByRole("link", { name: /Log follow-up/i });
    expect(link).toHaveAttribute("href", "/crm/health/acc-1?followUp=1");
  });
});
