import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PriceBookEditor } from "./PriceBookEditor";
import * as qp from "@/lib/crm/quotation";

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
    expect(await screen.findByText(/could not resolve/i)).toBeInTheDocument();
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
});
