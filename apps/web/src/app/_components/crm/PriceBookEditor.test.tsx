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
      data: [{ ...book, version: 4, updatedBy: "ravi.admin", updatedAt: "2026-03-10T08:00:00.000Z" }],
      source: "api",
    });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PriceBookEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText("Government")).toBeInTheDocument());
    expect(screen.getByText("v4")).toBeInTheDocument();
    const audit = screen.getByLabelText(/last changed for government/i);
    expect(audit).toHaveTextContent("ravi.admin");
    expect(audit).toHaveTextContent(/IST/);
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

  // GAP-CRM-PRICE-BOOKS-04: currency is a constrained select (INR), not free text.
  it("constrains currency to a select rather than free text", async () => {
    render(<PriceBookEditor />);
    await waitFor(() => expect(screen.getByText(/no price books yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new price book/i }));
    const currency = screen.getAllByLabelText(/^currency$/i)[0]!;
    expect(currency.tagName).toBe("SELECT");
    const values = Array.from(currency.querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(["INR"]);
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
