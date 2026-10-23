import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import enMessages from "@/messages/en.json";

// FormulationTable reads its tab/banner copy through next-intl (financeBudgetFormulation namespace).
const withIntl = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{children}</NextIntlClientProvider>
);
const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) => rtlRender(ui, { wrapper: withIntl, ...options });

const getBudgets = vi.fn();
vi.mock("../../../../_data/loaders", () => ({ getFinanceBudgets: () => getBudgets() }));
vi.mock("../../_components/FyFilter", () => ({ FyFilter: () => null }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null }),
}));

import BudgetFormulationPage from "./page";

function budget(id: string, fy: string, beMinor: string, sanctioned: string) {
  return {
    id, majorHead: `MH-${id}`, subHead: `Head ${id}`, sanctionedAmount: sanctioned, releasedAmount: "0",
    expenditure: "0", balance: "0", beMinor, reMinor: beMinor, status: "pending", financialYear: fy,
  };
}

describe("BudgetFormulationPage", () => {
  beforeEach(() => getBudgets.mockReset());

  // GAP-FINANCE-BUDGET-FORMULATION-02
  it("totals the selected FY's proposed BE only (not every year's sanctioned RE)", async () => {
    getBudgets.mockResolvedValue({
      data: [
        budget("a", "2026-27", "123456789", "999900000"),
        budget("b", "2025-26", "500000000", "500000000"),
      ],
      source: "api",
    });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27" } }));
    expect(screen.getByText("Proposed Outlay (BE, FY 2026-27)")).toBeInTheDocument();
    // the card (and the row's BE cell) show this FY's BE total
    expect(screen.getAllByText("₹12,34,567.89").length).toBeGreaterThan(0);
    expect(screen.getByText("Budget estimates (BE) — FY 2026-27")).toBeInTheDocument();
    expect(screen.queryByText("MH-b")).not.toBeInTheDocument();
  });

  it("ignores a malformed ?fy= and falls back to a valid FY label", async () => {
    getBudgets.mockResolvedValue({ data: [], source: "api" });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-99" } }));
    expect(screen.queryByText(/FY 2026-99/)).not.toBeInTheDocument();
  });

  // GAP-FINANCE-BUDGET-FORMULATION-03
  it("on a failed fetch shows — cards and a Retry state, not ₹0.00 / No records", async () => {
    getBudgets.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27" } }));
    expect(screen.getByText("We couldn't load budget estimates.")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBe(4);
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
  });

  it("a genuinely empty FY still shows zeros, no error", async () => {
    getBudgets.mockResolvedValue({ data: [], source: "api" });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27" } }));
    expect(screen.getByText("₹0.00")).toBeInTheDocument();
    expect(screen.queryByText(/We couldn't load/)).not.toBeInTheDocument();
  });
});

// GAP-FINANCE-BUDGET-FORMULATION-01/-04/-05
describe("BudgetFormulationPage -- column meaning, counts, vocabulary", () => {
  beforeEach(() => getBudgets.mockReset());
  const full = (o: Record<string, unknown>) => ({
    id: "x", majorHead: "2202", subHead: "Edu", sanctionedAmount: "500000", releasedAmount: "200000",
    expenditure: "0", balance: "0", beMinor: "1000000", reMinor: "1000000", status: "approved", financialYear: "2026-27", ...o,
  });

  it("each money column shows the field it is named for (BE=beMinor, Sanctioned, Released)", async () => {
    getBudgets.mockResolvedValue({ data: [full({})], source: "api" });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27" } }));
    const row = screen.getByText("2202").closest("tr")!;
    const cells = Array.from(row.querySelectorAll("td")).map((c) => c.textContent);
    const header = Array.from(row.closest("table")!.querySelectorAll("th")).map((c) => c.textContent?.replace(/[▲▼↕]/g, "").trim());
    const at = (label: string) => cells[header.findIndex((h) => h?.startsWith(label))];
    expect(at("Budget Estimate (BE)")).toBe("₹10,000.00");
    expect(at("Sanctioned")).toBe("₹5,000.00");
    expect(at("Released")).toBe("₹2,000.00");
  });

  it("Last Year (BE) is the previous FY's BE for the same head, or — when absent", async () => {
    getBudgets.mockResolvedValue({
      data: [
        full({ id: "cur", majorHead: "2202", beMinor: "1000000" }),
        full({ id: "prev", majorHead: "2202", financialYear: "2025-26", beMinor: "700000", sanctionedAmount: "1", releasedAmount: "1" }),
        full({ id: "new", majorHead: "3333", subHead: "Roads", beMinor: "1" }),
      ],
      source: "api",
    });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27" } }));
    const header = Array.from(screen.getAllByRole("columnheader")).map((c) => c.textContent?.replace(/[▲▼↕]/g, "").trim());
    const idx = header.findIndex((h) => h === "Last Year (BE)");
    const lastYear = (head: string) => screen.getByText(head).closest("tr")!.querySelectorAll("td")[idx].textContent;
    expect(lastYear("2202")).toBe("₹7,000.00");
    expect(lastYear("3333")).toBe("—");
  });

  it("a head repeated in the current FY gets last year's BE once, not on every row", async () => {
    getBudgets.mockResolvedValue({
      data: [
        full({ id: "c1", beMinor: "100" }),
        full({ id: "c2", beMinor: "200" }),
        full({ id: "p", financialYear: "2025-26", beMinor: "700000" }),
      ],
      source: "api",
    });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27" } }));
    const header = Array.from(screen.getAllByRole("columnheader")).map((c) => c.textContent?.replace(/[▲▼↕]/g, "").trim());
    const idx = header.findIndex((h) => h === "Last Year (BE)");
    const cells = screen.getAllByRole("row").slice(1).map((r) => r.querySelectorAll("td")[idx]?.textContent);
    expect(cells.filter((c) => c === "₹7,000.00").length).toBe(1);
  });

  it("Major Heads delta says approved N (matching the filter), and the card/tab share the word 'Pending'", async () => {
    getBudgets.mockResolvedValue({
      data: [full({ id: "a" }), full({ id: "b", majorHead: "2203" }), full({ id: "c", majorHead: "2204", status: "submitted" }), full({ id: "d", majorHead: "2205", status: "pending" })],
      source: "api",
    });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27" } }));
    expect(screen.getByText("approved 2")).toBeInTheDocument();
    expect(screen.queryByText("Pending Review")).not.toBeInTheDocument();
    // one word everywhere: the stat card, the tab, and the pending row's pill all read "Pending"
    expect(screen.getByRole("tab", { name: "Pending" })).toBeInTheDocument();
    expect(screen.getAllByText("Pending").length).toBe(3);
  });
});


// GAP-FINANCE-BUDGET-FORMULATION-05: land on the list, see the new estimate in its tab.
describe("BudgetFormulationPage -- ?highlight= / ?tab=", () => {
  beforeEach(() => getBudgets.mockReset());
  const NEW_ID = "0d9a8f2e-3c1b-4a55-9e7d-6f1c2b3a4d5e";
  const r = (id: string, majorHead: string, status: string) => ({
    id, majorHead, subHead: `Head ${majorHead}`, sanctionedAmount: "100", releasedAmount: "100", expenditure: "0", balance: "100",
    beMinor: "100", reMinor: "100", status, financialYear: "2026-27",
  });
  const DATA = [r("11111111-1111-4111-8111-111111111111", "2201", "exhausted"), r(NEW_ID, "2202", "active")];
  const selectedTab = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")?.textContent;

  it("opens the tab of the highlighted row and announces it", async () => {
    getBudgets.mockResolvedValue({ data: DATA, source: "api" });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27", highlight: NEW_ID } }));
    expect(selectedTab()).toBe("Active");
    expect(screen.getByText("Estimate added: 2202 · Head 2202 (FY 2026-27). It is listed under the Active tab.")).toBeInTheDocument();
    expect(screen.getByText("2202")).toBeInTheDocument();
    expect(screen.queryByText("2201")).not.toBeInTheDocument();
  });

  it("an explicit ?tab= wins over the highlighted row's tab", async () => {
    getBudgets.mockResolvedValue({ data: DATA, source: "api" });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27", highlight: NEW_ID, tab: "exhausted" } }));
    expect(selectedTab()).toBe("Exhausted");
  });

  it("a highlight that is not in the list yet says it is still being processed; junk params are ignored", async () => {
    getBudgets.mockResolvedValue({ data: DATA, source: "api" });
    const { unmount } = render(await BudgetFormulationPage({ searchParams: { fy: "2026-27", highlight: "22222222-2222-4222-8222-222222222222" } }));
    expect(screen.getByText(/still being processed/)).toBeInTheDocument();
    expect(selectedTab()).toBe("All");
    unmount();
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27", highlight: "<script>", tab: "nope" } }));
    expect(selectedTab()).toBe("All");
    expect(screen.queryByText(/Estimate added|still being processed/)).not.toBeInTheDocument();
  });
});
