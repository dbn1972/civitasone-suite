import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import RecurringEntriesPage from "./page";

describe("RecurringEntriesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of recurring entries", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        data: [
          {
            id: "r1",
            name: "Monthly Rent",
            voucherType: "journal",
            frequency: "monthly",
            amountMinor: "500000",
            nextRunDate: "2026-09-01",
            endDate: null,
            isActive: true,
          },
        ],
        source: "api",
      })
      .mockResolvedValueOnce({ data: [{ id: "a1", code: "1000", name: "Cash" }], source: "api" });

    const ui = await RecurringEntriesPage();
    render(ui);

    expect(screen.getByText("Monthly Rent")).toBeInTheDocument();
  });

  it("renders an empty state when there are no recurring entries", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await RecurringEntriesPage();
    render(ui);

    expect(screen.getByText("No recurring entries yet")).toBeInTheDocument();
  });

  // GAP2-FINANCE-RECURRING-ENTRIES-07: a failed /recurring-entries fetch must
  // render a retry error state replacing the stats + table, NOT a believable
  // "Total Templates 0" + "no recurring entries" clean record. (Before this
  // fix the page showed only a small DataSourceBadge and the "0" stats/empty
  // table.)
  it("renders a retry error state (not 0-stats + empty table) when the entries fetch fails", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [], source: "error", status: 500 })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await RecurringEntriesPage();
    render(ui);

    // The retry affordance is present...
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // ...and the misleading "0 / no recurring entries" clean record is NOT.
    expect(screen.queryByText("Total Templates")).not.toBeInTheDocument();
    expect(screen.queryByText("No recurring entries yet")).not.toBeInTheDocument();
  });

  // GAP2-FINANCE-RECURRING-ENTRIES-07: a 403 is an access-restricted state, not a retry.
  it("renders an access-restricted state (no retry) when the entries fetch is 403", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [], source: "error", status: 403 })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await RecurringEntriesPage();
    render(ui);

    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.queryByText("Total Templates")).not.toBeInTheDocument();
  });

  // A genuine empty (200 []) still shows the empty state, not the error state.
  it("still shows the empty state for a genuine empty entries list", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await RecurringEntriesPage();
    render(ui);

    expect(screen.getByText("No recurring entries yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  // GAP-FINANCE-RECURRING-ENTRIES-03: an empty chart of accounts is NOT a load error.
  it("treats an empty accounts list as empty (guidance), not as an error", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" });
    render(await RecurringEntriesPage());
    expect(screen.getByText(/No accounts defined/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("passes a failed accounts fetch through as an error state with Retry", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "error" });
    render(await RecurringEntriesPage());
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("the accounts mapper accepts an empty list (no false invalid_payload)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await RecurringEntriesPage();
    const accountsCall = fetchJsonMock.mock.calls.find((c) => String(c[0]).includes("/accounts"))!;
    const mapResponse = (accountsCall[2] as { mapResponse: (p: unknown) => unknown }).mapResponse;
    expect(mapResponse({ data: [] })).toEqual([]);
  });
});
