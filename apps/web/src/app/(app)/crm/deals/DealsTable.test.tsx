import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, within, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

import { useSeededResource } from "@/lib/sync/resource";
import { DealsTable } from "./DealsTable";

const mockedHook = vi.mocked(useSeededResource);

type Deal = {
  id: string;
  dealName: string;
  contactId?: string | null;
  contactName?: string | null;
  amount: string;
  stage: string;
  status: string;
  owner: string;
  closeDate?: string | null;
  probability?: number;
};

function seed(data: Deal[], provenance: "live" | "cached" | "error-no-data") {
  mockedHook.mockReturnValue({
    data,
    provenance,
    offline: false,
    cachedAt: provenance === "cached" ? "2026-10-01T00:00:00.000Z" : null,
    fromCache: provenance === "cached",
  } as unknown as ReturnType<typeof useSeededResource>);
}

const DEALS: Deal[] = [
  { id: "1", dealName: "Open A", contactId: "c1", contactName: "Officer A", amount: "5000000", stage: "prospecting", status: "open", owner: "U1" },
  { id: "2", dealName: "Won B", contactId: null, contactName: "Dept B", amount: "2000000", stage: "closed_won", status: "won", owner: "U2" },
  { id: "3", dealName: "Lost C", contactId: "c3", contactName: "Officer C", amount: "1000000", stage: "closed_lost", status: "lost", owner: "U3" },
];

describe("DealsTable", () => {
  beforeEach(() => mockedHook.mockReset());

  // GAP-CRM-DEALS-01: closed_won -> 'Concluded', closed_lost -> 'Lapsed'.
  it("relabels closed stages to Concluded / Lapsed (not 'closed won'/'closed lost')", () => {
    seed(DEALS, "live");
    render(<DealsTable deals={DEALS} source="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Concluded")).toBeInTheDocument();
    expect(within(table).getByText("Lapsed")).toBeInTheDocument();
    expect(within(table).queryByText(/closed won/i)).not.toBeInTheDocument();
    expect(within(table).queryByText(/closed lost/i)).not.toBeInTheDocument();
  });

  // Restored from the deals page test when the stat cards moved into DealsTable (GAP-CRM-DEALS-03).
  it("shows the 'Active Procurement Value' and 'Concluded Value' stat labels (not 'Completed Value')", () => {
    seed(DEALS, "live");
    render(<DealsTable deals={DEALS} source="api" />);
    expect(screen.getByText("Active Procurement Value")).toBeInTheDocument();
    expect(screen.getByText("Concluded Value")).toBeInTheDocument();
    expect(screen.queryByText("Completed Value")).not.toBeInTheDocument();
  });

  it("renders the Total / Active Engagements stat cards with real counts (3 total, 1 active)", () => {
    seed(DEALS, "live");
    render(<DealsTable deals={DEALS} source="api" />);
    const total = screen.getByText("Total Engagements").parentElement as HTMLElement;
    const active = screen.getByText("Active Engagements").parentElement as HTMLElement;
    expect(within(total).getByText("3")).toBeInTheDocument();
    expect(within(active).getByText("1")).toBeInTheDocument();
  });

  it("labels prospecting as 'Prospecting' in the Stage column", () => {
    seed(DEALS, "live");
    render(<DealsTable deals={DEALS} source="api" />);
    expect(within(screen.getByRole("table")).getByText("Prospecting")).toBeInTheDocument();
  });

  // GAP-CRM-DEALS-02: a Lapsed segment exists and filters status==='lost'.
  it("offers a 'Lapsed' segment that shows only lost engagements", () => {
    seed(DEALS, "live");
    render(<DealsTable deals={DEALS} source="api" />);
    const lapsedSeg = screen.getByRole("tab", { name: "Lapsed" });
    fireEvent.click(lapsedSeg);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Lost C")).toBeInTheDocument();
    expect(within(table).queryByText("Open A")).not.toBeInTheDocument();
    expect(within(table).queryByText("Won B")).not.toBeInTheDocument();
  });

  // GAP-CRM-DEALS-02: a Lapsed stat card counts lost engagements (= 1 here).
  it("counts lapsed engagements in a Lapsed stat card", () => {
    seed(DEALS, "live");
    render(<DealsTable deals={DEALS} source="api" />);
    const card = screen.getByText("Lapsed Engagements").closest("*")?.parentElement;
    expect(card).not.toBeNull();
    expect(screen.getByText("Lapsed Engagements")).toBeInTheDocument();
  });

  // GAP-CRM-DEALS-04: pipeline value sums paise with BigInt exactly.
  it("sums open-pipeline value as exact bigint paise", () => {
    // 9007199254740993 + 1 would lose precision as a JS number (> 2^53).
    const big: Deal[] = [
      { id: "a", dealName: "Big1", amount: "9007199254740993", stage: "prospecting", status: "open", owner: "U", contactName: "X" },
      { id: "b", dealName: "Big2", amount: "1", stage: "prospecting", status: "open", owner: "U", contactName: "Y" },
    ];
    seed(big, "live");
    render(<DealsTable deals={big} source="api" />);
    // 9007199254740994 paise = ₹9,00,71,99,25,47,409.94 (Indian grouping)
    expect(screen.getByText("₹9,00,71,99,25,47,409.94")).toBeInTheDocument();
  });

  // GAP-CRM-DEALS-03: a failed load with nothing cached shows '—', never 0 / ₹0.00.
  it("shows '—' in stat cards on error-no-data, not fabricated zeros", () => {
    seed([], "error-no-data");
    render(<DealsTable deals={[]} source="error" />);
    const dashes = screen.getAllByText("—");
    // All five stat cards show the em dash.
    expect(dashes.length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.getByText(/Couldn't load/i)).toBeInTheDocument();
  });

  // GAP-CRM-DEALS-05: contact links to /crm/contacts/:id when present, plain '—' otherwise.
  it("links the Contact / Company name to the contact when contactId is present", () => {
    seed(DEALS, "live");
    render(<DealsTable deals={DEALS} source="api" />);
    const link = screen.getByRole("link", { name: "Officer A" });
    expect(link).toHaveAttribute("href", "/crm/contacts/c1");
    // 'Dept B' has no contactId -> rendered as plain text, no link.
    expect(screen.queryByRole("link", { name: "Dept B" })).not.toBeInTheDocument();
  });

  it("renames the Account column to 'Contact / Company'", () => {
    seed(DEALS, "live");
    render(<DealsTable deals={DEALS} source="api" />);
    expect(screen.getByRole("columnheader", { name: /Contact \/ Company/i })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /^Account$/i })).not.toBeInTheDocument();
  });

  // GAP-CRM-DEALS-07: 'Expected close' and 'Probability' columns are shown.
  it("shows 'Expected close' and 'Probability' columns with mapped values", () => {
    const withDates: Deal[] = [
      { id: "1", dealName: "Open A", contactId: "c1", contactName: "Officer A", amount: "5000000", stage: "prospecting", status: "open", owner: "U1", closeDate: "2026-03-31", probability: 40 },
    ];
    seed(withDates, "live");
    render(<DealsTable deals={withDates} source="api" />);
    expect(screen.getByRole("columnheader", { name: /Expected close/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /^Probability$/i })).toBeInTheDocument();
    const table = screen.getByRole("table");
    // formatIndianDate renders the ISO date in a human form; probability as "40%".
    expect(within(table).getByText("40%")).toBeInTheDocument();
  });

  it("renders '—' for a deal with no expected close date (GAP-CRM-DEALS-07)", () => {
    const undated: Deal[] = [
      { id: "1", dealName: "Open A", contactId: "c1", contactName: "Officer A", amount: "5000000", stage: "prospecting", status: "open", owner: "U1", probability: 0 },
    ];
    seed(undated, "live");
    render(<DealsTable deals={undated} source="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("—")).toBeInTheDocument();
    expect(within(table).getByText("0%")).toBeInTheDocument();
  });
});
