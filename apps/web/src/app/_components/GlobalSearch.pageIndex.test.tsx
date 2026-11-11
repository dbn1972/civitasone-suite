import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import hiMessages from "@/messages/hi.json";
import { GlobalSearch } from "./GlobalSearch";

/**
 * UAT-P3 (NAV-01): with record search down (gateway 503, Meilisearch not
 * reachable) every query used to show only "Search is temporarily
 * unavailable". The page index must always answer, and say record search is
 * down with a retry.
 */
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}
const EMPTY = { data: [], meta: { page: 1, pageSize: 20, total: 0 } };
const DOWN = { error: { code: "SEARCH_UNAVAILABLE", message: "Search service is temporarily unavailable" } };

function openPalette() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
  });
}

beforeEach(() => mockPush.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("GlobalSearch page index (UAT-P3 NAV-01)", () => {
  it("answers DDO with the DDO page while record search is down, and offers a retry", async () => {
    global.fetch = respond(503, DOWN);
    render(<GlobalSearch />);
    openPalette();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "DDO" } });
    // Pages answer at once, before the debounced record call.
    expect(screen.getByRole("option", { name: /DDOs/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Record search unavailable — try again."));
    expect(screen.getByRole("option", { name: /DDOs/ })).toBeInTheDocument();

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls + 1));
  });

  it("opens a page with the keyboard", async () => {
    global.fetch = respond(503, DOWN);
    render(<GlobalSearch />);
    openPalette();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "JV" } });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", "search-result-0");
    fireEvent.keyDown(document, { key: "Enter" });
    expect(mockPush).toHaveBeenCalledWith("/finance/accounting/vouchers/new");
  });

  it("shows matching pages and a no-records note when record search finds nothing", async () => {
    global.fetch = respond(200, EMPTY);
    render(<GlobalSearch />);
    openPalette();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "GRN" } });
    await waitFor(() => expect(screen.getByText("No matching records")).toBeInTheDocument());
    expect(screen.getByRole("option", { name: /Goods receipt notes \(GRN\)/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("1 matching page")).toBeInTheDocument();
  });

  it("never offers a page the user cannot open", () => {
    global.fetch = respond(200, EMPTY);
    render(<GlobalSearch roles={["crm_user"]} enabledModules={null} />);
    openPalette();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "JV" } });
    expect(screen.queryByRole("option", { name: /journal voucher/i })).toBeNull();
  });

  it("works in Hindi: labels, placeholder, Hindi queries and the failure message", async () => {
    global.fetch = respond(503, DOWN);
    render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <GlobalSearch />
      </NextIntlClientProvider>,
    );
    openPalette();
    const input = screen.getByRole("combobox", { name: "वैश्विक खोज" });
    expect(input).toHaveAttribute("placeholder", "पृष्ठ और रिकॉर्ड खोजें… (जैसे DDO, JV, PO/2026)");
    expect(screen.getByText("खोजने के लिए कम से कम 2 अक्षर लिखें")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "छुट्टी" } });
    expect(screen.getByRole("option", { name: /मेरी छुट्टी/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("रिकॉर्ड खोज अभी उपलब्ध नहीं है"));
    expect(screen.getByRole("button", { name: "फिर से प्रयास करें" })).toBeInTheDocument();
  });

  it("Ctrl+K toggles the palette and the combobox controls one listbox", () => {
    global.fetch = respond(200, EMPTY);
    render(<GlobalSearch />);
    openPalette();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-controls", "search-results-list");
    expect(screen.getByRole("listbox")).toHaveAttribute("id", "search-results-list");
    openPalette();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
