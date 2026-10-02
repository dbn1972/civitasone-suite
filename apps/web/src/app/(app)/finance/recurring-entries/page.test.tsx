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
            voucher_type: "journal",
            frequency: "monthly",
            amount_minor: "500000",
            next_run_date: "2026-09-01",
            end_date: null,
            is_active: true,
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

  it("shows the data-source badge when the loader falls back on error", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [], source: "error" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await RecurringEntriesPage();
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
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
