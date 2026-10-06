import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { QuotationBuilder } from "./QuotationBuilder";
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

  it("convert-to-order is gated behind a ConfirmDialog (accepted quote only)", async () => {
    const acceptedQuote: qp.Quotation = { ...quote, status: "accepted" };
    vi.mocked(qp.getQuotations).mockResolvedValue({ data: [acceptedQuote], source: "api" });
    vi.mocked(qp.convertToOrder).mockResolvedValue(undefined);
    render(<QuotationBuilder />);
    await waitFor(() => expect(screen.getByText(/^standard$/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^open$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /convert to order/i }));
    const confirm = await screen.findAllByRole("button", { name: /convert to order/i });
    fireEvent.click(confirm[confirm.length - 1]);
    await waitFor(() => expect(qp.convertToOrder).toHaveBeenCalledWith("q1"));
  });

  // GAP-CRM-QUOTATIONS-04: actions follow the server state machine. A converted/
  // accepted quote no longer offers Send or (for accepted) nothing re-sendable.
  it("hides Send/Accept on an accepted quote and only offers Convert + New version", async () => {
    vi.mocked(qp.getQuotations).mockResolvedValue({ data: [{ ...quote, status: "accepted" }], source: "api" });
    render(<QuotationBuilder />);
    await waitFor(() => expect(screen.getByText(/^standard$/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^open$/i }));
    await screen.findByRole("button", { name: /convert to order/i });
    expect(screen.queryByRole("button", { name: /send \/ finalize/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^accept$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^reject$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new version \(clone\)/i })).toBeInTheDocument();
  });

  // GAP-CRM-QUOTATIONS-04: a draft offers Send but not Accept.
  it("offers Send but not Accept on a draft quote", async () => {
    vi.mocked(qp.getQuotations).mockResolvedValue({ data: [quote], source: "api" });
    render(<QuotationBuilder />);
    await waitFor(() => expect(screen.getByText(/^standard$/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^open$/i }));
    await screen.findByRole("button", { name: /send \/ finalize/i });
    expect(screen.queryByRole("button", { name: /^accept$/i })).not.toBeInTheDocument();
  });

  // GAP-CRM-QUOTATIONS-04: Accept opens a confirm and does not call the API until
  // confirmed.
  it("Accept on a sent quote opens a confirm and only calls the API after confirmation", async () => {
    vi.mocked(qp.getQuotations).mockResolvedValue({ data: [{ ...quote, status: "sent" }], source: "api" });
    vi.mocked(qp.acceptQuotation).mockResolvedValue(undefined);
    render(<QuotationBuilder />);
    await waitFor(() => expect(screen.getByText(/^standard$/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^open$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^accept$/i }));
    expect(await screen.findByText(/record the customer.s acceptance/i)).toBeInTheDocument();
    expect(qp.acceptQuotation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /record acceptance/i }));
    await waitFor(() => expect(qp.acceptQuotation).toHaveBeenCalledWith("q1"));
  });

  // GAP-CRM-QUOTATIONS-03: saving an existing quote re-opens the created version
  // and the message names it; the button says "Save as new version".
  it("saves an existing quote as a new version, re-opens it, and names the version", async () => {
    const v1: qp.Quotation = { ...quote, id: "q1", quoteRef: "QTN/2026/Z", version: 1, status: "draft" };
    const v2: qp.Quotation = { ...v1, id: "q2", version: 2 };
    vi.mocked(qp.getQuotations)
      .mockResolvedValueOnce({ data: [v1], source: "api" }) // initial load
      .mockResolvedValue({ data: [v2, v1], source: "api" }); // after save
    vi.mocked(qp.updateQuotation).mockResolvedValue({ id: "q2" });
    render(<QuotationBuilder />);
    await waitFor(() => expect(screen.getByText(/^standard$/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^open$/i }));
    const saveBtn = await screen.findByRole("button", { name: /save as new version/i });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(qp.updateQuotation).toHaveBeenCalledWith("q1", expect.anything()));
    expect(await screen.findByText(/saved as version v2/i)).toBeInTheDocument();
  });

  // GAP-CRM-QUOTATIONS-06: template label (not slug), status pill, and the
  // subtotal / total tax / grand total footer.
  it("renders a template label, a status pill and a subtotal/total-tax/grand-total footer", async () => {
    const q: qp.Quotation = {
      id: "qt", quoteRef: "QTN/2026/T", template: "government-tender", version: 1, status: "sent",
      lines: [{ productId: "pr1", productName: "Server", quantity: 3, unitPriceMinor: "10000", taxRateBps: 1800 }],
    };
    vi.mocked(qp.getQuotations).mockResolvedValue({ data: [q], source: "api" });
    render(<QuotationBuilder />);
    await waitFor(() => expect(screen.getByText("Government tender")).toBeInTheDocument());
    expect(screen.queryByText("government-tender")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^open$/i }));
    // 3 * 100 = 300 subtotal, 18% = 54 tax, 354 grand total.
    expect(await screen.findByLabelText(/^subtotal$/i)).toHaveTextContent("₹300.00");
    expect(screen.getByLabelText(/^total tax$/i)).toHaveTextContent("₹54.00");
    expect(screen.getByLabelText(/^grand total$/i)).toHaveTextContent("₹354.00");
    // Status pill (not raw enum text).
    expect(document.querySelector(".pill")).toBeTruthy();
  });

  // GAP-CRM-QUOTATIONS-02: the list must distinguish two "standard v1" quotes.
  it("lists quote ref, account, opportunity and created date so rows are distinguishable", async () => {
    const a: qp.Quotation = {
      id: "qa", quoteRef: "QTN/2026/AAA111", accountId: "acc-1", opportunityId: "deal-1",
      createdAt: "2026-02-03T10:00:00.000Z", template: "standard", version: 1, status: "draft", lines: [],
    };
    const b: qp.Quotation = {
      id: "qb", quoteRef: "QTN/2026/BBB222", accountId: "acc-2", opportunityId: "deal-2",
      createdAt: "2026-02-04T10:00:00.000Z", template: "standard", version: 1, status: "draft", lines: [],
    };
    vi.mocked(qp.getQuotations).mockResolvedValue({ data: [a, b], source: "api" });
    render(<QuotationBuilder />);
    await waitFor(() => expect(screen.getByText("QTN/2026/AAA111")).toBeInTheDocument());
    expect(screen.getByText("QTN/2026/BBB222")).toBeInTheDocument();
    expect(screen.getByText("acc-1")).toBeInTheDocument();
    expect(screen.getByText("deal-2")).toBeInTheDocument();
  });

  it("carries the chosen opportunity (dealId) when a quotation is created from scratch", async () => {
    vi.mocked(qp.createQuotation).mockResolvedValue(undefined);
    render(<QuotationBuilder />);
    await waitFor(() => expect(screen.getByText(/no quotations yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new quotation/i }));
    fireEvent.change(screen.getByLabelText(/opportunity id/i), { target: { value: "deal-xyz" } });
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));
    fireEvent.change(screen.getByLabelText(/product for line 1/i), { target: { value: "pr1" } });
    fireEvent.change(screen.getByLabelText(/quantity for line 1/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /create quotation/i }));
    await waitFor(() => expect(qp.createQuotation).toHaveBeenCalled());
    expect(vi.mocked(qp.createQuotation).mock.calls[0][0].opportunityId).toBe("deal-xyz");
  });

  // F4-02: entering matching state codes shows a CGST + SGST split in the footer;
  // differing codes show IGST. 18% of 300 = 54 -> 27 + 27 intra, 54 IGST inter.
  it("shows a CGST/SGST split for intra-state and IGST for inter-state", async () => {
    render(<QuotationBuilder />);
    await waitFor(() => expect(screen.getByText(/no quotations yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new quotation/i }));
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));
    fireEvent.change(screen.getByLabelText(/product for line 1/i), { target: { value: "pr1" } });
    fireEvent.change(screen.getByLabelText(/quantity for line 1/i), { target: { value: "3" } });
    // Intra-state: place == supplier.
    fireEvent.change(screen.getByLabelText(/place of supply state code/i), { target: { value: "27" } });
    fireEvent.change(screen.getByLabelText(/supplier state code/i), { target: { value: "27" } });
    expect(await screen.findByLabelText(/^cgst$/i)).toHaveTextContent("₹27.00");
    expect(screen.getByLabelText(/^sgst$/i)).toHaveTextContent("₹27.00");
    expect(screen.queryByLabelText(/^igst$/i)).not.toBeInTheDocument();
    // Inter-state: differing codes → IGST only.
    fireEvent.change(screen.getByLabelText(/supplier state code/i), { target: { value: "07" } });
    expect(await screen.findByLabelText(/^igst$/i)).toHaveTextContent("₹54.00");
    expect(screen.queryByLabelText(/^cgst$/i)).not.toBeInTheDocument();
  });

  // F4-01: the list Total column reads the server's grand_total_minor rather than
  // re-summing the lines client-side.
  it("shows the server-computed grand total in the list, not a client re-sum", async () => {
    const q: qp.Quotation = {
      id: "qg", quoteRef: "QTN/2026/G", template: "standard", version: 1, status: "sent",
      lines: [{ productId: "pr1", productName: "Server", quantity: 3, unitPriceMinor: "10000", taxRateBps: 1800 }],
      grandTotalMinor: "99999", // server authority — deliberately different to the re-sum (35400)
    };
    vi.mocked(qp.getQuotations).mockResolvedValue({ data: [q], source: "api" });
    render(<QuotationBuilder />);
    await waitFor(() => expect(screen.getByText("₹999.99")).toBeInTheDocument());
    expect(screen.queryByText("₹354.00")).not.toBeInTheDocument();
  });
});
