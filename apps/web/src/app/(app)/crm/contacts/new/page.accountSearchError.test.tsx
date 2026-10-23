import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import enMessages from "@/messages/en.json";
import NewContactPage from "./page";

vi.mock("@/lib/crm/dataQuality", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/dataQuality")>();
  return { ...actual, duplicateCheck: vi.fn(async () => []) };
});
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("NewContactPage: CLOS2-S1-07 account picker search failure", () => {
  it("shows the search-error text, not 'No matches', when GET v1/crm/accounts fails", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("crm/accounts")
        ? { ok: false, status: 500, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({ data: [] }) },
    );
    renderWithIntl(<NewContactPage />);
    const input = screen.getByPlaceholderText(enMessages.crmContactNewPage.searchAccounts);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "acme" } });
    await waitFor(() => expect(screen.getAllByText(/load results/i).length).toBeGreaterThan(0));
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });
});
