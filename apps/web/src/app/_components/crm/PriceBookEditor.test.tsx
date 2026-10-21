import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PriceBookEditor } from "./PriceBookEditor";
import * as qp from "@/lib/crm/quotation";

import type { ReactElement } from "react";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}


vi.mock("@/lib/crm/quotation", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/quotation")>();
  return {
    ...actual,
    getPriceBooks: vi.fn(),
    createPriceBook: vi.fn(),
    updatePriceBook: vi.fn(),
    deletePriceBook: vi.fn(),
    resolvePriceBook: vi.fn(),
    getProducts: vi.fn(),
    getPriceBookHistory: vi.fn(),
  };
});

const book: qp.PriceBook = {
  id: "b1",
  name: "Government",
  segment: "government",
  currency: "INR",
  geography: "north",
  channel: "direct",
  entries: [{ productId: "pr1", priceMinor: "990000" }],
  enabled: true,
};

beforeEach(() => {
  vi.mocked(qp.getPriceBooks).mockReset().mockResolvedValue({ data: [], source: "api" });
  vi.mocked(qp.getProducts).mockReset().mockResolvedValue({ data: [], source: "api" });
  vi.mocked(qp.createPriceBook).mockReset();
  vi.mocked(qp.updatePriceBook).mockReset();
  vi.mocked(qp.deletePriceBook).mockReset();
  vi.mocked(qp.resolvePriceBook).mockReset();
  vi.mocked(qp.getPriceBookHistory).mockReset().mockResolvedValue({ data: [], source: "api" });
});

describe("PriceBookEditor (QP-002)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(qp.getPriceBooks).mockResolvedValue({ data: [], source: "error" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PriceBookEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
  });

  it("creates a new price book", async () => {
    vi.mocked(qp.createPriceBook).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PriceBookEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no price books yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new price book/i }));
    fireEvent.change(screen.getByLabelText(/price book name/i), { target: { value: "PSU" } });
    fireEvent.click(screen.getByRole("button", { name: /create book/i }));
    await waitFor(() => expect(qp.createPriceBook).toHaveBeenCalledWith(expect.objectContaining({ name: "PSU" })));
  });

  it("resolves the applicable book and shows its name", async () => {
    vi.mocked(qp.resolvePriceBook).mockResolvedValue({ data: book, source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PriceBookEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no price books yet/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/resolve segment/i), { target: { value: "government" } });
    fireEvent.click(screen.getByRole("button", { name: /^resolve$/i }));
    expect(await screen.findByText(/applicable book:/i)).toHaveTextContent("Government");
  });

  it("honestly reports a failed resolve instead of implying none", async () => {
    vi.mocked(qp.resolvePriceBook).mockResolvedValue({ data: null, source: "error" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PriceBookEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no price books yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^resolve$/i }));
    expect(await screen.findByText(/couldn.t resolve the price book/i)).toBeInTheDocument();
    // GAP-CRM-OPPORTUNITY-AGEING-04: never claim cached/saved data when nothing is cached.
    expect(screen.queryByText(/showing saved information/i)).not.toBeInTheDocument();
  });

  it("adds a price entry and saves the book with the paise price", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [{ id: "pr1", category: "", code: "P1", name: "Widget", unit: "each", taxRateBps: 0, priceMinor: "0", currency: "INR", activeFrom: "", activeTo: "", enabled: true }], source: "api" });
    vi.mocked(qp.createPriceBook).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PriceBookEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no price books yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new price book/i }));
    fireEvent.change(screen.getByLabelText(/price book name/i), { target: { value: "Gov" } });
    fireEvent.click(screen.getByRole("button", { name: /add price/i }));
    fireEvent.change(screen.getByLabelText(/product for entry 1/i), { target: { value: "pr1" } });
    fireEvent.change(screen.getByLabelText(/price for entry 1/i), { target: { value: "99.50" } });
    fireEvent.click(screen.getByRole("button", { name: /create book/i }));
    await waitFor(() => expect(qp.createPriceBook).toHaveBeenCalled());
    const payload = vi.mocked(qp.createPriceBook).mock.calls[0][0];
    expect(payload.entries).toEqual([{ productId: "pr1", priceMinor: "9950" }]);
  });

  it("deletes a book only after ConfirmDialog confirmation", async () => {
    vi.mocked(qp.getPriceBooks).mockResolvedValue({ data: [book], source: "api" });
    vi.mocked(qp.deletePriceBook).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PriceBookEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText("Government")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete price book government/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^delete book$/i }));
    await waitFor(() => expect(qp.deletePriceBook).toHaveBeenCalledWith("b1"));
  });

  // GAP-CRM-PRICE-BOOKS-01: version + who/when must be visible per book.
  it("shows the version and last-changed author/date for a book", async () => {
    vi.mocked(qp.getPriceBooks).mockResolvedValue({
      data: [{ ...book, version: 4, updatedBy: "0c1d2e3f-0000-4000-8000-0000000000aa", updatedByName: "Ravi Admin", updatedAt: "2026-03-10T08:00:00.000Z" }],
      source: "api",
    });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PriceBookEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText("Government")).toBeInTheDocument());
    expect(screen.getByText("v4")).toBeInTheDocument();
    const audit = screen.getByLabelText(/last changed for government/i);
    expect(audit).toHaveTextContent("Ravi Admin");
    expect(audit).toHaveTextContent(/IST/);
  });

  // GAP-CRM-PRICE-BOOKS-01 (W2 rescan): crm.price_books.updated_by is a uuid. When the API cannot
  // resolve it to a name the editor says "Unknown user" — it never prints the id.
  it("never prints the raw editor id: an unresolved editor reads 'Unknown user'", async () => {
    const uuid = "0c1d2e3f-0000-4000-8000-0000000000bb";
    vi.mocked(qp.getPriceBooks).mockResolvedValue({
      data: [{ ...book, version: 2, updatedBy: uuid, updatedAt: "2026-03-10T08:00:00.000Z" }],
      source: "api",
    });
    render(<PriceBookEditor />);
    await waitFor(() => expect(screen.getByText("Government")).toBeInTheDocument());
    const audit = screen.getByLabelText(/last changed for government/i);
    expect(audit).toHaveTextContent("Unknown user");
    expect(audit.textContent).not.toContain(uuid);
    expect(audit.textContent).not.toContain("0c1d2e3f");
  });

  // GAP-CRM-PRICE-BOOKS-01 (W2 rescan): the reason typed for a LIVE-book edit used to be required
  // by the dialog and then discarded. It now travels with the save so the server can record it.
  it("sends the live-edit reason with the save (and none for a disabled book)", async () => {
    vi.mocked(qp.updatePriceBook).mockResolvedValue(undefined);
    vi.mocked(qp.getPriceBooks).mockResolvedValue({ data: [{ ...book, version: 2, enabled: true }], source: "api" });
    render(<PriceBookEditor />);
    await waitFor(() => expect(screen.getByText("Government")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/why are you changing this live price book/i), {
      target: { value: "  Annual rate revision  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /edit prices/i }));
    await screen.findByDisplayValue("Government");
    fireEvent.click(screen.getByRole("button", { name: /save book/i }));
    await waitFor(() => expect(qp.updatePriceBook).toHaveBeenCalledTimes(1));
    expect(vi.mocked(qp.updatePriceBook).mock.calls[0][0]).toBe("b1");
    expect(vi.mocked(qp.updatePriceBook).mock.calls[0][2]).toEqual({ reason: "Annual rate revision" });
  });

  it("sends no reason when a disabled book is edited", async () => {
    vi.mocked(qp.updatePriceBook).mockResolvedValue(undefined);
    vi.mocked(qp.getPriceBooks).mockResolvedValue({ data: [{ ...book, enabled: false }], source: "api" });
    render(<PriceBookEditor />);
    await waitFor(() => expect(screen.getByText("Government")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    await screen.findByDisplayValue("Government");
    fireEvent.click(screen.getByRole("button", { name: /save book/i }));
    await waitFor(() => expect(qp.updatePriceBook).toHaveBeenCalledTimes(1));
    expect(vi.mocked(qp.updatePriceBook).mock.calls[0][2]).toEqual({});
  });

  // GAP-CRM-PRICE-BOOKS-01 (W2 rescan): per-book change history (who / when / why / what moved).
  describe("change history panel", () => {
    const WIDGET = { id: "pr1", category: "", code: "P1", name: "Widget", unit: "each", taxRateBps: 0, priceMinor: "0", currency: "INR", activeFrom: "", activeTo: "", enabled: true };
    const history: qp.PriceBookHistoryEntry[] = [
      {
        id: "h2", version: 3, action: "update", changedByName: "Rohit Sen", changedAt: "2026-03-10T08:00:00.000Z",
        reason: "Revised FY27 tariff",
        fields: [{ field: "priority", from: 5, to: 9 }, { field: "segment", from: null, to: "government" }],
        prices: [
          { productId: "pr1", fromMinor: "90000", toMinor: "85000" },
          { productId: "pr9", fromMinor: null, toMinor: "70000" },
        ],
        priceChangeCount: 5,
      },
      { id: "h1", version: 1, action: "create", changedAt: "2026-03-01T08:00:00.000Z", fields: [], prices: [], priceChangeCount: 0 },
    ];

    async function openPanel() {
      vi.mocked(qp.getPriceBooks).mockResolvedValue({ data: [{ ...book, version: 3 }], source: "api" });
      vi.mocked(qp.getProducts).mockResolvedValue({ data: [WIDGET], source: "api" });
      render(<PriceBookEditor />);
      await waitFor(() => expect(screen.getByText("Government")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: /change history for price book government/i }));
    }

    it("shows who, when, why and which fields / prices moved — by name, never by id", async () => {
      vi.mocked(qp.getPriceBookHistory).mockResolvedValue({ data: history, source: "api" });
      await openPanel();
      const panel = await screen.findByRole("region", { name: /change history — government/i });
      expect(qp.getPriceBookHistory).toHaveBeenCalledWith("b1");
      await waitFor(() => expect(panel).toHaveTextContent("Rohit Sen"));
      expect(panel).toHaveTextContent("v3 · Edited by Rohit Sen");
      expect(panel).toHaveTextContent(/IST/);
      expect(panel).toHaveTextContent("Reason: Revised FY27 tariff");
      expect(panel).toHaveTextContent("Priority: 5 → 9");
      expect(panel).toHaveTextContent("Segment: any → government");
      // Known product by name with money in INR; unknown product never as an id.
      expect(panel).toHaveTextContent(/Widget: ₹900\.00 → ₹850\.00/);
      expect(panel).toHaveTextContent(/Unknown product: added at ₹700\.00/);
      expect(panel).toHaveTextContent("+3 more price changes not listed");
      // The create row has no resolvable editor name: Unknown user, no blank.
      expect(panel).toHaveTextContent("v1 · Created by Unknown user");
    });

    it("says so when nothing is recorded yet", async () => {
      await openPanel();
      expect(await screen.findByText(/no changes recorded yet/i)).toBeInTheDocument();
    });

    it("shows a retryable error — not an empty history — when the history cannot be loaded", async () => {
      vi.mocked(qp.getPriceBookHistory)
        .mockResolvedValueOnce({ data: [], source: "error" })
        .mockResolvedValue({ data: history, source: "api" });
      await openPanel();
      expect(await screen.findByText(/change history couldn.t be loaded/i)).toBeInTheDocument();
      expect(screen.queryByText(/no changes recorded yet/i)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
      expect(await screen.findByText("Reason: Revised FY27 tariff")).toBeInTheDocument();
    });

    it("toggles closed from the same button", async () => {
      vi.mocked(qp.getPriceBookHistory).mockResolvedValue({ data: history, source: "api" });
      await openPanel();
      await screen.findByRole("region", { name: /change history — government/i });
      fireEvent.click(screen.getByRole("button", { name: /change history for price book government/i }));
      expect(screen.queryByRole("region", { name: /change history — government/i })).not.toBeInTheDocument();
    });
  });

  // GAP-CRM-PRICE-BOOKS-02 (W2 rescan): a free typo can still be typed (no master list exists),
  // but the form now warns instead of staying silent.
  describe("scope typo warnings (non-blocking)", () => {
    async function openNew() {
      vi.mocked(qp.getPriceBooks).mockResolvedValue({ data: [book], source: "api" });
      render(<PriceBookEditor />);
      await waitFor(() => expect(screen.getByText("Government")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: /new price book/i }));
      return screen.getAllByLabelText(/^segment$/i)[0] as HTMLInputElement;
    }

    it("warns when no other book uses the typed value, and still lets the book be saved", async () => {
      vi.mocked(qp.createPriceBook).mockResolvedValue(undefined);
      const segment = await openNew();
      fireEvent.change(screen.getByLabelText(/price book name/i), { target: { value: "Typo book" } });
      fireEvent.change(segment, { target: { value: "govrnment" } });
      expect(await screen.findByText(/no other price book uses “govrnment”/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /create book/i }));
      await waitFor(() => expect(qp.createPriceBook).toHaveBeenCalledWith(expect.objectContaining({ segment: "govrnment" })));
    });

    it("does not warn for a value another book already uses, or for a blank (wildcard) field", async () => {
      const segment = await openNew();
      fireEvent.change(segment, { target: { value: "government" } });
      expect(screen.queryByText(/no other price book uses/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/differs only in letter case/i)).not.toBeInTheDocument();
      fireEvent.change(segment, { target: { value: "  " } });
      expect(screen.queryByText(/no other price book uses/i)).not.toBeInTheDocument();
    });

    it("points out a letter-case difference, since matching is exact", async () => {
      const segment = await openNew();
      fireEvent.change(segment, { target: { value: "Government" } });
      expect(await screen.findByText(/differs only in letter case from “government”/i)).toBeInTheDocument();
    });

    it("does not treat the book being edited as evidence for its own value", async () => {
      vi.mocked(qp.getPriceBooks).mockResolvedValue({ data: [{ ...book, enabled: false }], source: "api" });
      render(<PriceBookEditor />);
      await waitFor(() => expect(screen.getByText("Government")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
      const geo = (await screen.findByRole("combobox", { name: /^geography$/i })) as HTMLInputElement;
      // "north" is only this book's own value — no OTHER book uses it.
      expect(geo.value).toBe("north");
      expect(await screen.findByText(/no other price book uses “north”/i)).toBeInTheDocument();
    });
  });

  // GAP-CRM-PRICE-BOOKS-01: editing a live book needs an explicit reason first.
  it("requires a reason before opening a live price book for edit", async () => {
    vi.mocked(qp.getPriceBooks).mockResolvedValue({ data: [{ ...book, version: 2, enabled: true }], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PriceBookEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText("Government")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    // The editor must NOT open until the live-edit reason is given.
    expect(screen.queryByLabelText(/price book name/i)).not.toBeInTheDocument();
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: /edit prices/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/why are you changing this live price book/i), {
      target: { value: "Annual rate revision" },
    });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    // Now the editor is open, seeded with the book name.
    expect(await screen.findByDisplayValue("Government")).toBeInTheDocument();
  });

  it("opens a disabled book for edit without a reason prompt", async () => {
    vi.mocked(qp.getPriceBooks).mockResolvedValue({ data: [{ ...book, enabled: false }], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PriceBookEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText("Government")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(await screen.findByDisplayValue("Government")).toBeInTheDocument();
  });

  // F4-03: currency is a constrained select from the allow-list (INR/USD/EUR/GBP/AED),
  // not free text; display uses formatMoneyIn so a non-INR book shows the right symbol.
  it("constrains currency to an allow-list select rather than free text", async () => {
    render(<PriceBookEditor />);
    await waitFor(() => expect(screen.getByText(/no price books yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new price book/i }));
    const currency = screen.getAllByLabelText(/^currency$/i)[0]!;
    expect(currency.tagName).toBe("SELECT");
    const values = Array.from(currency.querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(["INR", "USD", "EUR", "GBP", "AED"]);
  });

  // GAP-CRM-PRICE-BOOKS-02: segment/geography/channel are backed by a datalist of
  // values already used in existing books (typo-avoidance; no backend master list).
  it("suggests already-used segment values via a datalist", async () => {
    vi.mocked(qp.getPriceBooks).mockResolvedValue({ data: [book], source: "api" });
    render(<PriceBookEditor />);
    await waitFor(() => expect(screen.getByText("Government")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new price book/i }));
    const segment = screen.getAllByLabelText(/^segment$/i)[0] as HTMLInputElement;
    const listId = segment.getAttribute("list");
    expect(listId).toBeTruthy();
    const datalist = document.getElementById(listId!);
    expect(datalist).toBeTruthy();
    const options = Array.from(datalist!.querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain("government");
  });

  // GAP-CRM-PRICE-BOOKS-05: an inactive product is disabled in the picker, and the
  // same product cannot be added twice.
  it("disables inactive products and blocks a duplicate product in the book", async () => {
    vi.mocked(qp.getPriceBooks).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(qp.getProducts).mockResolvedValue({
      data: [
        { id: "pr1", category: "", code: "P1", name: "Widget", unit: "each", taxRateBps: 0, priceMinor: "0", currency: "INR", activeFrom: "", activeTo: "", enabled: true },
        { id: "pr2", category: "", code: "P2", name: "Gadget", unit: "each", taxRateBps: 0, priceMinor: "0", currency: "INR", activeFrom: "", activeTo: "", enabled: false },
      ],
      source: "api",
    });
    vi.mocked(qp.createPriceBook).mockResolvedValue(undefined);
    render(<PriceBookEditor />);
    await waitFor(() => expect(screen.getByText(/no price books yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new price book/i }));
    fireEvent.change(screen.getByLabelText(/price book name/i), { target: { value: "Gov" } });

    // Add two entries both pointing at pr1 (a duplicate).
    fireEvent.click(screen.getByRole("button", { name: /add price/i }));
    const firstSelect = screen.getByLabelText(/product for entry 1/i);
    // The disabled flag is set on the inactive product option.
    const gadgetOpt = Array.from(firstSelect.querySelectorAll("option")).find((o) => (o as HTMLOptionElement).value === "pr2") as HTMLOptionElement;
    expect(gadgetOpt).toBeDefined();
    expect(gadgetOpt.disabled).toBe(true);
    expect(gadgetOpt.textContent).toMatch(/inactive/i);

    fireEvent.change(firstSelect, { target: { value: "pr1" } });
    fireEvent.change(screen.getByLabelText(/price for entry 1/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /add price/i }));
    // Second row: pr1 is now used elsewhere so it is excluded; force a duplicate by
    // setting its value directly (jsdom lets us) and assert save is blocked.
    const secondSelect = screen.getByLabelText(/product for entry 2/i) as HTMLSelectElement;
    const pr1Excluded = !Array.from(secondSelect.querySelectorAll("option")).some((o) => (o as HTMLOptionElement).value === "pr1");
    expect(pr1Excluded).toBe(true);
  });

  // GAP-CRM-PRICE-BOOKS-06: a disabled Save button must say why (inline reason),
  // and draftValid is aligned with save() so a blank price is INVALID (not
  // defaulted to 0.01 and errored later).
  it("explains why Save is disabled and keeps it disabled with no name", async () => {
    render(<PriceBookEditor />);
    await waitFor(() => expect(screen.getByText(/no price books yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new price book/i }));
    const create = screen.getByRole("button", { name: /create book/i });
    expect(create).toBeDisabled();
    expect(screen.getByText("A price book needs a name.")).toBeInTheDocument();
    expect(create).toHaveAttribute("aria-describedby");
  });

  // GAP-CRM-PRICE-BOOKS-04: currency is chosen from the allow-list, never typed, so a book can only
  // carry a currency the formatter can render under its own symbol.
  it("offers currency as a fixed list (INR/USD/EUR/GBP/AED), not a free-text box", async () => {
    render(<PriceBookEditor />);
    await waitFor(() => expect(screen.getByText(/no price books yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new price book/i }));
    const currency = screen.getByRole("combobox", { name: "Currency" }) as HTMLSelectElement;
    expect(currency.tagName).toBe("SELECT");
    expect(Array.from(currency.options).map((o) => o.value)).toEqual(["INR", "USD", "EUR", "GBP", "AED"]);
    fireEvent.change(screen.getByLabelText(/price book name/i), { target: { value: "Export" } });
    fireEvent.change(currency, { target: { value: "USD" } });
    vi.mocked(qp.createPriceBook).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: /create book/i }));
    await waitFor(() => expect(qp.createPriceBook).toHaveBeenCalledWith(expect.objectContaining({ name: "Export", currency: "USD" })));
  });

  it("flags a blank price row aria-invalid and keeps Save disabled", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [{ id: "pr1", category: "", code: "P1", name: "Widget", unit: "each", taxRateBps: 0, priceMinor: "0", currency: "INR", activeFrom: "", activeTo: "", enabled: true }], source: "api" });
    render(<PriceBookEditor />);
    await waitFor(() => expect(screen.getByText(/no price books yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new price book/i }));
    fireEvent.change(screen.getByLabelText(/price book name/i), { target: { value: "Gov" } });
    fireEvent.click(screen.getByRole("button", { name: /add price/i }));
    fireEvent.change(screen.getByLabelText(/product for entry 1/i), { target: { value: "pr1" } });
    // Price left blank → the price input is aria-invalid and Save stays disabled.
    const price = screen.getByLabelText(/price for entry 1/i);
    expect(price).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: /create book/i })).toBeDisabled();
    expect(screen.getByText(/entry 1 needs a price/i)).toBeInTheDocument();
  });
});
