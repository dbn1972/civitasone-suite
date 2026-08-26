import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    render(<PriceBookEditor />);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
  });

  it("creates a new price book", async () => {
    vi.mocked(qp.createPriceBook).mockResolvedValue(undefined);
    render(<PriceBookEditor />);
    await waitFor(() => expect(screen.getByText(/no price books yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new price book/i }));
    fireEvent.change(screen.getByLabelText(/price book name/i), { target: { value: "PSU" } });
    fireEvent.click(screen.getByRole("button", { name: /create book/i }));
    await waitFor(() => expect(qp.createPriceBook).toHaveBeenCalledWith(expect.objectContaining({ name: "PSU" })));
  });

  it("resolves the applicable book and shows its name", async () => {
    vi.mocked(qp.resolvePriceBook).mockResolvedValue({ data: book, source: "api" });
    render(<PriceBookEditor />);
    await waitFor(() => expect(screen.getByText(/no price books yet/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/resolve segment/i), { target: { value: "government" } });
    fireEvent.click(screen.getByRole("button", { name: /^resolve$/i }));
    expect(await screen.findByText(/applicable book:/i)).toHaveTextContent("Government");
  });

  it("honestly reports a failed resolve instead of implying none", async () => {
    vi.mocked(qp.resolvePriceBook).mockResolvedValue({ data: null, source: "error" });
    render(<PriceBookEditor />);
    await waitFor(() => expect(screen.getByText(/no price books yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^resolve$/i }));
    expect(await screen.findByText(/could not resolve/i)).toBeInTheDocument();
  });

  it("adds a price entry and saves the book with the paise price", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [{ id: "pr1", category: "", code: "P1", name: "Widget", unit: "each", taxRateBps: 0, priceMinor: "0", currency: "INR", activeFrom: "", activeTo: "", enabled: true }], source: "api" });
    vi.mocked(qp.createPriceBook).mockResolvedValue(undefined);
    render(<PriceBookEditor />);
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
    render(<PriceBookEditor />);
    await waitFor(() => expect(screen.getByText("Government")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete price book government/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^delete book$/i }));
    await waitFor(() => expect(qp.deletePriceBook).toHaveBeenCalledWith("b1"));
  });
});
