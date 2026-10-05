import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProductCatalogueEditor } from "./ProductCatalogueEditor";
import * as qp from "@/lib/crm/quotation";

vi.mock("@/lib/crm/quotation", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/quotation")>();
  return { ...actual, getProducts: vi.fn(), createProduct: vi.fn(), updateProduct: vi.fn(), deleteProduct: vi.fn() };
});

const product: qp.Product = {
  id: "pr1",
  category: "Hardware",
  code: "SRV-1",
  name: "Rack server",
  unit: "each",
  taxRateBps: 1800,
  priceMinor: "5000000",
  currency: "INR",
  activeFrom: "",
  activeTo: "",
  enabled: true,
};

beforeEach(() => {
  vi.mocked(qp.getProducts).mockReset();
  vi.mocked(qp.createProduct).mockReset();
  vi.mocked(qp.updateProduct).mockReset();
  vi.mocked(qp.deleteProduct).mockReset();
});

describe("ProductCatalogueEditor (QP-001)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [], source: "error" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProductCatalogueEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
  });

  it("creates a product converting rupees to paise and % to bps", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(qp.createProduct).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProductCatalogueEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no products yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add product/i }));
    fireEvent.change(screen.getByLabelText(/code for product 1/i), { target: { value: "SRV-2" } });
    fireEvent.change(screen.getByLabelText(/name for product 1/i), { target: { value: "Blade" } });
    fireEvent.change(screen.getByLabelText(/price for product 1/i), { target: { value: "1200.75" } });
    fireEvent.change(screen.getByLabelText(/tax percent for product 1/i), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(qp.createProduct).toHaveBeenCalled());
    const payload = vi.mocked(qp.createProduct).mock.calls[0][0];
    expect(payload.priceMinor).toBe("120075");
    expect(payload.taxRateBps).toBe(1800);
  });

  it("blocks a product with an invalid price", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProductCatalogueEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no products yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add product/i }));
    fireEvent.change(screen.getByLabelText(/code for product 1/i), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText(/name for product 1/i), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText(/price for product 1/i), { target: { value: "12.999" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/valid price/i)).toBeInTheDocument();
    expect(qp.createProduct).not.toHaveBeenCalled();
  });

  it("updates an existing product via PUT", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [product], source: "api" });
    vi.mocked(qp.updateProduct).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProductCatalogueEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByDisplayValue("Rack server")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for product 1/i), { target: { value: "Rack server v2" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(qp.updateProduct).toHaveBeenCalledWith("pr1", expect.objectContaining({ name: "Rack server v2" })));
  });

  // GAP-CRM-PRODUCTS-01: audit visibility — who last changed the product/when.
  it("shows the last-changed author and date when the API returns them", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({
      data: [{ ...product, updatedBy: "priya.admin", updatedAt: "2026-03-01T09:00:00.000Z" }],
      source: "api",
    });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProductCatalogueEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByDisplayValue("Rack server")).toBeInTheDocument());
    const cell = screen.getByLabelText(/last changed for product 1/i);
    expect(cell).toHaveTextContent("priya.admin");
  });

  // GAP-CRM-PRODUCTS-01: deleting a product that feeds quotations/price books
  // must warn and steer the admin to soft-disable instead.
  it("warns about references and recommends disabling in the delete dialog", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [product], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ProductCatalogueEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByDisplayValue("Rack server")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete product 1/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/referenced by existing quotations and price books/i);
    expect(dialog).toHaveTextContent(/turning the product/i);
    expect(screen.getByRole("button", { name: /delete anyway/i })).toBeInTheDocument();
  });
});
