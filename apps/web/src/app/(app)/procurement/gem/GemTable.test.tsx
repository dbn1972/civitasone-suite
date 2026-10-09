import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

import { useSeededResource } from "@/lib/sync/resource";
import { GemTable } from "./GemTable";
import type { GemItem } from "../../../_data/loaders";

const mockedHook = vi.mocked(useSeededResource);

type Prov = "live" | "cached" | "error-no-data";
function seed(data: GemItem[], provenance: Prov) {
  mockedHook.mockReturnValue({
    data,
    provenance,
    offline: false,
    cachedAt: provenance === "cached" ? "2026-10-01T00:00:00.000Z" : null,
    fromCache: provenance === "cached",
  } as unknown as ReturnType<typeof useSeededResource>);
}

const ITEMS: GemItem[] = [
  { id: "1", orderId: "GEM-1", item: "Chairs", supplier: "A", amount: 125050, deliveryDate: "2026-09-01", gemStatus: "Delivered" },
  { id: "2", orderId: "GEM-2", item: "Desks", supplier: "B", amount: 200000, deliveryDate: "2026-09-02", gemStatus: "Shipped" },
  { id: "3", orderId: "GEM-3", item: "Lamps", supplier: "C", amount: 500000, deliveryDate: "2026-09-03", gemStatus: "Cancelled" },
  { id: "4", orderId: "GEM-4", item: "Fans", supplier: "D", amount: 100000, deliveryDate: "2026-09-04", gemStatus: "Placed" },
];

describe("GemTable", () => {
  beforeEach(() => { mockedHook.mockReset(); refreshMock.mockReset(); pushMock.mockReset(); });

  // GAP-PROCUREMENT-GEM-02: formatMoney; 125050 paise -> ₹1,250.50.
  it("formats amounts with formatMoney", () => {
    seed(ITEMS, "live");
    render(<GemTable items={ITEMS} source="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("₹1,250.50")).toBeInTheDocument();
    expect(within(table).queryByText("₹1,250.5")).not.toBeInTheDocument();
  });

  // GAP-PROCUREMENT-GEM-02: Total Value excludes cancelled. Spend = 125050 +
  // 200000 + 100000 = 425050 paise = ₹4,250.50 (the ₹5,000 Cancelled excluded).
  it("excludes cancelled orders from Total Value", () => {
    seed(ITEMS, "live");
    render(<GemTable items={ITEMS} source="api" />);
    expect(screen.getByText("Total Value (excl. cancelled)").closest(".stat")).toHaveTextContent("₹4,250.50");
  });

  // GAP-PROCUREMENT-GEM-04: cards reconcile to the order count.
  it("status buckets reconcile to Total Orders", () => {
    seed(ITEMS, "live");
    render(<GemTable items={ITEMS} source="api" />);
    const stat = (label: string) =>
      screen.getAllByText(label).map((el) => el.closest(".stat")).find(Boolean) as HTMLElement;
    expect(stat("Total Orders")).toHaveTextContent("4");
    expect(stat("Delivered")).toHaveTextContent("1");
    expect(stat("In Transit")).toHaveTextContent("1");
    // Cancelled (1) + Placed/other (1) = 2
    expect(stat("Other / Cancelled")).toHaveTextContent("2");
  });

  // GAP-PROCUREMENT-GEM-03: a real refresh and a last-updated stamp.
  it("renders a Refresh control and a last-updated stamp", () => {
    seed(ITEMS, "live");
    render(<GemTable items={ITEMS} source="api" />);
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
    expect(screen.getByText(/Last updated/i)).toBeInTheDocument();
  });

  // GAP-PROCUREMENT-GEM-01: error with no cache -> retry + '—' stats, not
  // "No GeM orders found" / ₹0.
  it("on error with no cache, shows a retry error and '—' stats", () => {
    seed([], "error-no-data");
    render(<GemTable items={[]} source="error" />);
    expect(screen.queryByText(/No GeM orders found/i)).not.toBeInTheDocument();
    expect(screen.getByText("Total Orders").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Total Value (excl. cancelled)").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  // GAP-PROCUREMENT-GEM-01: genuine empty api WITH a query -> the no-results
  // empty state, 0 stats (an empty result for a real search, not an error).
  it("on a genuine empty api result for a query, shows the no-results state with 0 orders", () => {
    seed([], "live");
    render(<GemTable items={[]} source="api" query="chairs" />);
    expect(screen.getByText(/No GeM items found/i)).toBeInTheDocument();
    expect(screen.getByText(/chairs/)).toBeInTheDocument();
    expect(screen.getByText("Total Orders").closest(".stat")).toHaveTextContent("0");
  });

  // GAP2-PROCUREMENT-GEM-ITEMS-08: integration-disabled is a DISTINCT empty
  // state ("GeM integration is not configured"), never a generic "no items".
  it("shows the integration-not-configured message when integrationDisabled", () => {
    seed([], "live");
    render(<GemTable items={[]} source="api" integrationDisabled reason="GeM integration is not configured (GEM_ENABLED/GEM_BASE_URL/GEM_API_KEY)." />);
    // The title is the distinct, operator-facing heading; the server reason is
    // shown as the diagnostic message beneath it.
    expect(screen.getByRole("heading", { name: /GeM integration is not configured/i })).toBeInTheDocument();
    expect(screen.getByText(/GEM_ENABLED/)).toBeInTheDocument();
    expect(screen.queryByText(/No GeM items found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Enter a search term/i)).not.toBeInTheDocument();
  });

  // GAP2-PROCUREMENT-GEM-ITEMS-08: no query entered -> prompt to search, not a
  // bare "no items" that reads as "none exist".
  it("prompts the operator to enter a search term when no query is supplied", () => {
    seed([], "live");
    render(<GemTable items={[]} source="api" query="" />);
    expect(screen.getByText(/Enter a search term/i)).toBeInTheDocument();
    expect(screen.queryByText(/No GeM items found/i)).not.toBeInTheDocument();
  });

  // GAP2-PROCUREMENT-GEM-ITEMS-08: the search box drives ?q= navigation.
  it("navigates to ?q=<term> when a search is submitted", () => {
    seed([], "live");
    render(<GemTable items={[]} source="api" query="" />);
    const box = screen.getByRole("searchbox", { name: /search the gem catalog/i });
    fireEvent.change(box, { target: { value: "office chairs" } });
    fireEvent.submit(box.closest("form")!);
    expect(pushMock).toHaveBeenCalledWith("/procurement/gem?q=office%20chairs");
  });
});
