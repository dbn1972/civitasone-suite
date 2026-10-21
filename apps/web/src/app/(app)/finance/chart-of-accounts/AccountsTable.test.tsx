import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import enMessages from "@/messages/en.json";

// AccountsTable reads its level / parent copy through next-intl (financeChartOfAccounts namespace).
const withIntl = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{children}</NextIntlClientProvider>
);
const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) => rtlRender(ui, { wrapper: withIntl, ...options });

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";

const mockedHook = vi.mocked(useSeededResource);
function seed(data: unknown, provenance: "live" | "cached" | "error-no-data") {
  mockedHook.mockReturnValue({
    data: data as never, fromCache: provenance === "cached", offline: false,
    cachedAt: provenance === "cached" ? "2026-09-01T00:00:00.000Z" : null, provenance,
  } as never);
}
import { AccountsTable } from "./AccountsTable";

describe("AccountsTable (GAP-FINANCE-CHART-OF-ACCOUNTS-01)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("failed load with no cache shows retry and NO 'Add your first head' CTA", () => {
    seed([], "error-no-data");
    render(<AccountsTable accounts={[]} source="error" />);
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/No accounts set up yet/)).not.toBeInTheDocument();
    expect(screen.queryByText("+ Add Head")).not.toBeInTheDocument();
  });

  it("a genuinely empty live chart still shows the first-run CTA", () => {
    seed([], "live");
    render(<AccountsTable accounts={[]} source="api" canWrite />);
    expect(screen.getByText(/No accounts set up yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ Add Head" })).toHaveAttribute("href", "/finance/chart-of-accounts/new");
  });

  // GAP-FINANCE-CHART-OF-ACCOUNTS-05: a read-only finance role is not told to add a head it cannot add.
  it("a viewer who cannot write sees the empty chart without the + Add Head action", () => {
    seed([], "live");
    render(<AccountsTable accounts={[]} source="api" />);
    expect(screen.getByText(/No accounts set up yet/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "+ Add Head" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Add your first head to get started/)).not.toBeInTheDocument();
    expect(screen.getByText(/a finance officer can add them/)).toBeInTheDocument();
  });
});

// ── GAP-FINANCE-CHART-OF-ACCOUNTS-02/-03/-04 ───────────────────────────────
import { fireEvent } from "@testing-library/react";

const ROW = (i: number, type: "asset" | "liability" | "equity" | "income" | "expense", balanceDisplay = "0.00") => ({
  id: `h${i}`, code: String(1000 + i), name: `Head ${i}`, type, currency: "INR", balanceDisplay, status: "active" as const,
});

describe("AccountsTable stat cards, equity filter, balance sign, paging", () => {
  beforeEach(() => mockedHook.mockReset());

  it("Income / Expense counts only income+expense; equity has its own card (2 asset, 1 equity, 3 income)", () => {
    seed([ROW(1, "asset"), ROW(2, "asset"), ROW(3, "equity"), ROW(4, "income"), ROW(5, "income"), ROW(6, "income")], "live");
    render(<AccountsTable accounts={[]} source="api" />);
    expect(screen.getByText("Income / Expense").closest(".stat")).toHaveTextContent("3");
    expect(screen.getByText("Asset / Liability").closest(".stat")).toHaveTextContent("2");
    expect(screen.getByText("Equity", { selector: ".lab" }).closest(".stat")).toHaveTextContent("1");
  });

  it("the Equity segment shows equity heads", () => {
    seed([ROW(1, "asset"), ROW(3, "equity")], "live");
    render(<AccountsTable accounts={[]} source="api" />);
    expect(screen.getByText("Head 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Equity" }));
    expect(screen.queryByText("Head 1")).not.toBeInTheDocument();
    expect(screen.getByText("Head 3")).toBeInTheDocument();
  });

  it("a negative balance puts the sign before the rupee symbol", () => {
    seed([ROW(1, "asset", "-12,345.67")], "live");
    render(<AccountsTable accounts={[]} source="api" />);
    expect(screen.getByText("-₹12,345.67")).toBeInTheDocument();
    expect(screen.queryByText("₹-12,345.67")).not.toBeInTheDocument();
  });

  it("500 rows render 20 per page with a pager and a CSV export", () => {
    seed(Array.from({ length: 500 }, (_, i) => ROW(i, "asset")), "live");
    render(<AccountsTable accounts={[]} source="api" />);
    expect(screen.getByText("Head 0")).toBeInTheDocument();
    expect(screen.queryByText("Head 20")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /csv/i })).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 25/)).toBeInTheDocument();
  });
});

// ── GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-02: the list is a tree ────────────────
describe("AccountsTable hierarchy (a created head shows under its parent)", () => {
  beforeEach(() => mockedHook.mockReset());

  const H = (id: string, code: string, name: string, level: 0 | 1 | 2, parentId: string | null = null) => ({
    id, code, name, level, parentId, type: "liability" as const, currency: "INR", balanceDisplay: "0.00", status: "active" as const,
  });
  // listed in an arbitrary order, as the API returns them
  const CHART = [
    H("sub", "2101", "Trade Creditors", 2, "min"),
    H("other", "3000", "Assets", 0),
    H("min", "2100", "Creditors", 1, "maj"),
    H("maj", "2000", "Liabilities", 0),
  ];
  const bodyRows = () => screen.getAllByRole("row").slice(1).map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.textContent?.trim()));

  it("lists each head directly under its parent, with its level and parent named", () => {
    seed(CHART, "live");
    render(<AccountsTable accounts={[]} source="api" />);
    const rows = bodyRows();
    // Code | Name (indented) | Level | Parent
    expect(rows.map((r) => [r[0], r[2], r[3]])).toEqual([
      ["2000", "Major head", "—"],
      ["2100", "Minor head", "2000"],
      ["2101", "Sub-minor head", "2100"],
      ["3000", "Major head", "—"],
    ]);
    // the child's name is indented under its parent (visual marker + padding), the major head's is not
    expect(rows[1]![1]).toContain("└");
    expect(rows[0]![1]).not.toContain("└");
    const nameCell = screen.getByText("Trade Creditors").closest("span") as HTMLElement;
    expect(nameCell.style.paddingInlineStart).toBe("40px");
  });

  it("a search keeps each match where it sits and still names its parent", () => {
    seed(CHART, "live");
    render(<AccountsTable accounts={[]} source="api" />);
    fireEvent.change(screen.getByLabelText("Search by name or code"), { target: { value: "trade" } });
    const rows = bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe("2101");
    expect(rows[0]![2]).toBe("Sub-minor head");
    expect(rows[0]![3]).toBe("2100");
  });

  it("a head whose parent is not in this list says so instead of looking like a major head", () => {
    seed([H("c", "2101", "Orphan", 2, "not-loaded")], "live");
    render(<AccountsTable accounts={[]} source="api" />);
    const [row] = bodyRows();
    expect(row![2]).toBe("Sub-minor head");
    expect(row![3]).toBe("Not in this list");
  });

  it("an older feed without level falls back to the head's depth in the tree", () => {
    seed(CHART.map(({ level: _l, ...rest }) => rest), "live");
    render(<AccountsTable accounts={[]} source="api" />);
    expect(bodyRows().map((r) => r[2])).toEqual(["Major head", "Minor head", "Sub-minor head", "Major head"]);
  });
});
