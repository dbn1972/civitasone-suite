import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QuotationBuilder } from "./QuotationBuilder";
import * as qp from "@/lib/crm/quotation";

vi.mock("@/lib/crm/quotation", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/quotation")>();
  return {
    ...actual,
    getQuotations: vi.fn(),
    getProducts: vi.fn(),
    createQuotation: vi.fn(),
    updateQuotation: vi.fn(),
    sendQuotation: vi.fn(),
    acceptQuotation: vi.fn(),
    rejectQuotation: vi.fn(),
    newQuotationVersion: vi.fn(),
    convertToOrder: vi.fn(),
    getQuotationVersions: vi.fn(),
    getApprovals: vi.fn(),
    requestApproval: vi.fn(),
    approveApproval: vi.fn(),
    resolvePriceBook: vi.fn(),
  };
});

const product: qp.Product = {
  id: "pr1",
  category: "HW",
  code: "SRV",
  name: "Server",
  unit: "each",
  taxRateBps: 1800,
  priceMinor: "10000",
  currency: "INR",
  activeFrom: "",
  activeTo: "",
  enabled: true,
};
const quote: qp.Quotation = {
  id: "q1",
  template: "standard",
  version: 1,
  status: "draft",
  lines: [{ productId: "pr1", productName: "Server", quantity: 3, unitPriceMinor: "10000", taxRateBps: 1800 }],
};

beforeEach(() => {
  vi.mocked(qp.getQuotations).mockReset().mockResolvedValue({ data: [], source: "api" });
  vi.mocked(qp.getProducts).mockReset().mockResolvedValue({ data: [product], source: "api" });
  vi.mocked(qp.createQuotation).mockReset();
  vi.mocked(qp.updateQuotation).mockReset();
  vi.mocked(qp.sendQuotation).mockReset();
  vi.mocked(qp.getQuotationVersions).mockReset().mockResolvedValue({ data: [], source: "api" });
  vi.mocked(qp.getApprovals).mockReset().mockResolvedValue({ data: [], source: "api" });
  vi.mocked(qp.resolvePriceBook).mockReset();
});

describe("QuotationBuilder (QP-003/004/005)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(qp.getQuotations).mockResolvedValue({ data: [], source: "error" });
    render(<QuotationBuilder />);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
  });

  it("builds a line and computes the grand total with tax via money.ts", async () => {
    vi.mocked(qp.createQuotation).mockResolvedValue(undefined);
    render(<QuotationBuilder />);
    await waitFor(() => expect(screen.getByText(/no quotations yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new quotation/i }));
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));
    fireEvent.change(screen.getByLabelText(/product for line 1/i), { target: { value: "pr1" } });
    fireEvent.change(screen.getByLabelText(/quantity for line 1/i), { target: { value: "3" } });
    // 3 * 100.00 = 300.00 net, 18% tax = 54.00 -> total 354.00
    await waitFor(() => expect(screen.getAllByText("₹354.00").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /create quotation/i }));
    await waitFor(() => expect(qp.createQuotation).toHaveBeenCalled());
    const payload = vi.mocked(qp.createQuotation).mock.calls[0][0];
    expect(payload.lines[0].unitPriceMinor).toBe("10000");
    expect(payload.lines[0].quantity).toBe(3);
  });

  it("blocks save on an invalid tax %, shows '—' preview and flags the field, never coercing to 0", async () => {
    render(<QuotationBuilder />);
    await waitFor(() => expect(screen.getByText(/no quotations yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new quotation/i }));
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));
    fireEvent.change(screen.getByLabelText(/product for line 1/i), { target: { value: "pr1" } });
    fireEvent.change(screen.getByLabelText(/quantity for line 1/i), { target: { value: "2" } });
    // A garbage tax value must NOT silently become 0% — the row shows "—".
    const taxInput = screen.getByLabelText(/tax percent for line 1/i);
    fireEvent.change(taxInput, { target: { value: "abc" } });
    await waitFor(() => expect(taxInput).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /create quotation/i }));
    expect(await screen.findByText(/valid tax %/i)).toBeInTheDocument();
    expect(qp.createQuotation).not.toHaveBeenCalled();
    // Fixing the tax to a valid value clears the block and persists the real bps.
    fireEvent.change(taxInput, { target: { value: "18" } });
    vi.mocked(qp.createQuotation).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: /create quotation/i }));
    await waitFor(() => expect(qp.createQuotation).toHaveBeenCalled());
    expect(vi.mocked(qp.createQuotation).mock.calls[0][0].lines[0].taxRateBps).toBe(1800);
  });

  it("surfaces 422 APPROVAL_REQUIRED honestly and never fakes a send", async () => {
    vi.mocked(qp.getQuotations).mockResolvedValue({ data: [quote], source: "api" });
    vi.mocked(qp.sendQuotation).mockRejectedValue(new qp.ApprovalRequiredError("This quotation has an unapproved discount or deviation. Get approval before sending."));
    render(<QuotationBuilder />);
    await waitFor(() => expect(screen.getByText(/^standard$/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^open$/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /send \/ finalize/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /send \/ finalize/i }));
    expect(await screen.findByText(/unapproved discount or deviation/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing has been sent/i)).toBeInTheDocument();
  });

  it("convert-to-order is gated behind a ConfirmDialog", async () => {
    vi.mocked(qp.getQuotations).mockResolvedValue({ data: [quote], source: "api" });
    vi.mocked(qp.convertToOrder).mockResolvedValue(undefined);
    render(<QuotationBuilder />);
    await waitFor(() => expect(screen.getByText(/^standard$/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^open$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /convert to order/i }));
    // dialog confirm
    const confirm = await screen.findAllByRole("button", { name: /convert to order/i });
    fireEvent.click(confirm[confirm.length - 1]);
    await waitFor(() => expect(qp.convertToOrder).toHaveBeenCalledWith("q1"));
  });
});
