import { NextIntlClientProvider } from "next-intl";
import { renderWithIntl } from "@/lib/testUtils/intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProductCatalogueEditor } from "./ProductCatalogueEditor";
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
    renderWithIntl(<ProductCatalogueEditor />);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
  });

  it("creates a product converting rupees to paise and % to bps", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(qp.createProduct).mockResolvedValue(undefined);
    renderWithIntl(<ProductCatalogueEditor />);
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
    renderWithIntl(<ProductCatalogueEditor />);
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
    renderWithIntl(<ProductCatalogueEditor />);
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
    renderWithIntl(<ProductCatalogueEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("Rack server")).toBeInTheDocument());
    const cell = screen.getByLabelText(/last changed for product 1/i);
    expect(cell).toHaveTextContent("priya.admin");
  });

  // GAP-CRM-PRODUCTS-01: deleting a product that feeds quotations/price books
  // must warn and steer the admin to soft-disable instead.
  it("warns about references and recommends disabling in the delete dialog", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [product], source: "api" });
    renderWithIntl(<ProductCatalogueEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("Rack server")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete product 1/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/referenced by existing quotations and price books/i);
    expect(dialog).toHaveTextContent(/turning the product/i);
    expect(screen.getByRole("button", { name: /delete anyway/i })).toBeInTheDocument();
  });

  // GAP-CRM-PRODUCTS-02: the tax field is a GST-slab select, so a fat-fingered
  // rate like 81% is not a one-keystroke slab (it requires explicit Custom), and
  // a custom rate above the 100% cap is rejected outright.
  it("offers GST slabs (no stray 81) and blocks a custom tax above 100%", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [], source: "api" });
    renderWithIntl(<ProductCatalogueEditor />);
    await waitFor(() => expect(screen.getByText(/no products yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add product/i }));
    const slab = screen.getByLabelText(/^tax percent for product 1/i) as HTMLSelectElement;
    const slabValues = Array.from(slab.querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value);
    expect(slabValues).toEqual(["", "0", "5", "12", "18", "28", "custom"]);
    expect(slabValues).not.toContain("81");
    fireEvent.change(screen.getByLabelText(/code for product 1/i), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText(/name for product 1/i), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText(/price for product 1/i), { target: { value: "100" } });
    fireEvent.change(slab, { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText(/custom tax percent for product 1/i), { target: { value: "181" } });
    expect(await screen.findByText(/enter a rate from 0 to 100%/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/a tax rate \(choose a gst slab/i)).toBeInTheDocument();
    expect(qp.createProduct).not.toHaveBeenCalled();
  });

  // GAP-CRM-PRODUCTS-03: a blank price can no longer save as a silent ₹0.00.
  it("blocks a blank price instead of saving a ₹0.00 product", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [], source: "api" });
    renderWithIntl(<ProductCatalogueEditor />);
    await waitFor(() => expect(screen.getByText(/no products yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add product/i }));
    fireEvent.change(screen.getByLabelText(/code for product 1/i), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText(/name for product 1/i), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText(/^tax percent for product 1/i), { target: { value: "18" } });
    // Price left blank.
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/valid price/i)).toBeInTheDocument();
    expect(qp.createProduct).not.toHaveBeenCalled();
  });

  // GAP-CRM-PRODUCTS-03: a deliberately-typed 0 price saves only after confirm.
  it("requires a confirm before saving a typed ₹0 price", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(qp.createProduct).mockResolvedValue(undefined);
    renderWithIntl(<ProductCatalogueEditor />);
    await waitFor(() => expect(screen.getByText(/no products yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add product/i }));
    fireEvent.change(screen.getByLabelText(/code for product 1/i), { target: { value: "FREE" } });
    fireEvent.change(screen.getByLabelText(/name for product 1/i), { target: { value: "Freebie" } });
    fireEvent.change(screen.getByLabelText(/price for product 1/i), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText(/^tax percent for product 1/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/with a ₹0.00 price/i)).toBeInTheDocument();
    expect(qp.createProduct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /save at ₹0.00/i }));
    await waitFor(() => expect(qp.createProduct).toHaveBeenCalled());
    expect(vi.mocked(qp.createProduct).mock.calls[0][0].priceMinor).toBe("0");
  });

  // GAP-CRM-PRODUCTS-05: Active-to before Active-from is blocked.
  it("blocks Active to earlier than Active from", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [product], source: "api" });
    renderWithIntl(<ProductCatalogueEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("Rack server")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/active from for product 1/i), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText(/active to for product 1/i), { target: { value: "2026-05-01" } });
    expect(await screen.findByText(/active to is before active from/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/active to cannot be before active from/i)).toBeInTheDocument();
    expect(qp.updateProduct).not.toHaveBeenCalled();
  });

  // GAP-CRM-PRODUCTS-05: toggling Enabled shows an Unsaved marker and does not
  // claim "Live" from an unsaved edit.
  it("marks a toggled row Unsaved and reads 'Live after save' rather than 'Live'", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [{ ...product, enabled: false }], source: "api" });
    renderWithIntl(<ProductCatalogueEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("Rack server")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/enable product 1/i));
    expect(screen.getByLabelText(/unsaved changes for product 1/i)).toBeInTheDocument();
    expect(screen.getByText(/live after save/i)).toBeInTheDocument();
  });

  // GAP-CRM-PRODUCTS-06: a duplicate code (case-insensitive) is flagged and
  // blocks Save (the backend has a unique (tenant, code) index).
  it("flags a duplicate product code and blocks save", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({
      data: [
        { ...product, id: "pr1", code: "SRV-1", name: "Rack server" },
        { ...product, id: "pr2", code: "srv-1", name: "Other server" },
      ],
      source: "api",
    });
    renderWithIntl(<ProductCatalogueEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("Rack server")).toBeInTheDocument());
    // Both rows show the duplicate-code message (case-insensitive match).
    expect(screen.getAllByText(/duplicate code/i).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);
    expect(await screen.findByText(/is already used by another product/i)).toBeInTheDocument();
    expect(qp.updateProduct).not.toHaveBeenCalled();
  });

  // GAP-CRM-PRODUCTS-06: currency is visible per row (constrained to INR —
  // decision recorded, no multi-currency money formatter yet).
  it("shows the currency per product row", async () => {
    vi.mocked(qp.getProducts).mockResolvedValue({ data: [product], source: "api" });
    renderWithIntl(<ProductCatalogueEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("Rack server")).toBeInTheDocument());
    const currency = screen.getByLabelText(/currency for product 1/i);
    expect(currency).toHaveTextContent("INR");
  });
});
